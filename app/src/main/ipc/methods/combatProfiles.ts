import { BrowserWindow } from "electron";
import { Effect, Scope } from "effect";
import {
  DEFAULT_COMBAT_PROFILE_ID,
  DEFAULT_COMBAT_PROFILE_LIBRARY,
  normalizeCombatProfileLibrary,
  parseCombatProfileAutoAttackState,
  type CombatProfile,
  type CombatProfileLibrary,
} from "../../../shared/combat-profiles";
import { CombatProfilesIpcChannels } from "../../../shared/ipc";
import { CombatProfileRepository } from "../../backend/combat-profiles/CombatProfileRepository";
import type { DesktopStorageError } from "../../storage/DesktopStorage";
import { DesktopIpc } from "../DesktopIpc";

const broadcastChanged = (state: CombatProfileLibrary): void => {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed() || win.webContents.isDestroyed()) {
      continue;
    }

    win.webContents.send(CombatProfilesIpcChannels.changed, state);
  }
};

const normalizeProfilePayload = (profile: unknown): CombatProfile => {
  const normalized = normalizeCombatProfileLibrary({ profiles: [profile] });
  const explicitId =
    typeof profile === "object" && profile !== null && "id" in profile
      ? (profile as { readonly id?: unknown }).id
      : undefined;

  if (explicitId === DEFAULT_COMBAT_PROFILE_ID) {
    return (
      normalized.profiles.find(
        (candidate) => candidate.id === DEFAULT_COMBAT_PROFILE_ID,
      ) ?? DEFAULT_COMBAT_PROFILE_LIBRARY.profiles[0]!
    );
  }

  return (
    normalized.profiles.find(
      (candidate) => candidate.id !== DEFAULT_COMBAT_PROFILE_ID,
    ) ??
    normalized.profiles[0] ??
    DEFAULT_COMBAT_PROFILE_LIBRARY.profiles[0]!
  );
};

const updateState = (
  update: (current: CombatProfileLibrary) => CombatProfileLibrary,
): Effect.Effect<
  CombatProfileLibrary,
  DesktopStorageError,
  CombatProfileRepository
> =>
  Effect.gen(function* () {
    const repository = yield* CombatProfileRepository;
    const normalized = yield* repository.update(update);
    yield* Effect.sync(() => broadcastChanged(normalized));
    return normalized;
  });

export const registerCombatProfilesIpcHandlers = (): Effect.Effect<
  void,
  never,
  CombatProfileRepository | DesktopIpc | Scope.Scope
> =>
  Effect.gen(function* () {
    const ipc = yield* DesktopIpc;

    yield* ipc.handle(CombatProfilesIpcChannels.getState, () =>
      Effect.gen(function* () {
        const repository = yield* CombatProfileRepository;
        return yield* repository.get;
      }),
    );

    yield* ipc.handle(
      CombatProfilesIpcChannels.saveProfile,
      (_event, profile) =>
        Effect.gen(function* () {
          const normalizedProfile = normalizeProfilePayload(profile);
          return yield* updateState((current) => ({
            ...current,
            profiles: [
              ...current.profiles.filter(
                (candidate) => candidate.id !== normalizedProfile.id,
              ),
              normalizedProfile,
            ],
          }));
        }),
    );

    yield* ipc.handle(
      CombatProfilesIpcChannels.deleteProfile,
      (_event, profileId) =>
        Effect.gen(function* () {
          const repository = yield* CombatProfileRepository;
          if (
            typeof profileId !== "string" ||
            profileId === DEFAULT_COMBAT_PROFILE_ID
          ) {
            return yield* repository.get;
          }

          return yield* updateState((current) => ({
            ...current,
            profiles: current.profiles.filter(
              (profile) => profile.id !== profileId,
            ),
          }));
        }),
    );

    yield* ipc.handle(
      CombatProfilesIpcChannels.setAutoAttack,
      (_event, state) =>
        Effect.gen(function* () {
          return yield* updateState((current) => {
            const autoAttack = parseCombatProfileAutoAttackState(
              state,
              new Set(current.profiles.map((profile) => profile.id)),
            );
            return {
              ...current,
              autoAttack,
            };
          });
        }),
    );
  });
