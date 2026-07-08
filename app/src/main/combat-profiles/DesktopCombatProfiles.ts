import { Context, Effect, Layer, Schema, SynchronizedRef } from "effect";

import {
  DEFAULT_COMBAT_PROFILE_ID,
  DEFAULT_COMBAT_PROFILE_LIBRARY,
  cloneCombatProfileLibrary,
  normalizeCombatProfile,
  normalizeCombatProfileLibrary,
  serializeCombatProfileLibrary,
  type CombatProfile,
  type CombatProfileLibrary,
} from "@lucent/core/combatProfiles";
import { DesktopEnvironment } from "../app/DesktopEnvironment";
import {
  type JsonFileError,
  readJsonFile,
  writeJsonFile,
} from "../settings/JsonFile";

const combatProfilesOperationSchema = Schema.Literals([
  "delete-profile",
  "mkdir",
  "parse",
  "read",
  "rename",
  "save-profile",
  "unlink",
  "write",
]);

export class DesktopCombatProfilesError extends Schema.TaggedErrorClass<DesktopCombatProfilesError>()(
  "DesktopCombatProfilesError",
  {
    detail: Schema.String,
    operation: combatProfilesOperationSchema,
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {
  override get message(): string {
    return this.detail;
  }
}

export interface DesktopCombatProfilesShape {
  readonly deleteProfile: (
    profileId: string,
  ) => Effect.Effect<CombatProfileLibrary, DesktopCombatProfilesError>;
  readonly get: Effect.Effect<CombatProfileLibrary, DesktopCombatProfilesError>;
  readonly load: Effect.Effect<
    CombatProfileLibrary,
    DesktopCombatProfilesError
  >;
  readonly onChanged: (
    listener: (library: CombatProfileLibrary) => void,
  ) => Effect.Effect<() => void>;
  readonly saveProfile: (
    profile: CombatProfile,
  ) => Effect.Effect<CombatProfileLibrary, DesktopCombatProfilesError>;
}

export class DesktopCombatProfiles extends Context.Service<
  DesktopCombatProfiles,
  DesktopCombatProfilesShape
>()("lucent/desktop/combat-profiles/DesktopCombatProfiles") {}

const wrapDataError = (error: JsonFileError): DesktopCombatProfilesError =>
  new DesktopCombatProfilesError({
    operation: error.operation,
    detail: error.message,
    cause: error,
  });

const validationError = (
  operation: typeof combatProfilesOperationSchema.Type,
  detail: string,
): DesktopCombatProfilesError =>
  new DesktopCombatProfilesError({
    operation,
    detail,
  });

const defaultLibrary = (): CombatProfileLibrary =>
  cloneCombatProfileLibrary(DEFAULT_COMBAT_PROFILE_LIBRARY);

const saveProfileToLibrary = (
  current: CombatProfileLibrary,
  profile: CombatProfile,
): CombatProfileLibrary => {
  const normalizedProfile = normalizeCombatProfile(profile);
  const existingIndex = current.profiles.findIndex(
    (candidate) => candidate.id === normalizedProfile.id,
  );
  const profiles =
    existingIndex === -1
      ? [...current.profiles, normalizedProfile]
      : current.profiles.map((candidate, index) =>
          index === existingIndex ? normalizedProfile : candidate,
        );

  return normalizeCombatProfileLibrary({
    ...current,
    profiles,
  });
};

const deleteProfileFromLibrary = (
  current: CombatProfileLibrary,
  profileId: string,
): Effect.Effect<CombatProfileLibrary, DesktopCombatProfilesError> =>
  Effect.gen(function* () {
    if (profileId === DEFAULT_COMBAT_PROFILE_ID) {
      return yield* validationError(
        "delete-profile",
        "The generic combat profile cannot be deleted.",
      );
    }

    const profiles = current.profiles.filter(
      (profile) => profile.id !== profileId,
    );
    if (profiles.length === current.profiles.length) {
      return yield* validationError(
        "delete-profile",
        "Combat profile does not exist.",
      );
    }

    return normalizeCombatProfileLibrary({
      ...current,
      profiles,
    });
  });

const makeDesktopCombatProfiles = Effect.gen(function* () {
  const env = yield* DesktopEnvironment;
  const path = env.appDataPath("combat-profiles.json");
  const libraryRef = yield* SynchronizedRef.make<CombatProfileLibrary | null>(
    null,
  );
  const listeners = new Set<(library: CombatProfileLibrary) => void>();

  const readLibraryFromFile = Effect.gen(function* () {
    const result = yield* readJsonFile(path).pipe(
      Effect.mapError(wrapDataError),
    );
    if (result.status === "missing") {
      const defaults = defaultLibrary();
      yield* writeJsonFile(path, serializeCombatProfileLibrary(defaults)).pipe(
        Effect.mapError(wrapDataError),
      );
      return defaults;
    }

    const library = yield* Effect.try({
      try: () => normalizeCombatProfileLibrary(result.value),
      catch: (cause) =>
        new DesktopCombatProfilesError({
          operation: "parse",
          detail:
            cause instanceof Error
              ? cause.message
              : "Invalid combat profile library.",
          cause,
        }),
    });
    yield* writeJsonFile(path, serializeCombatProfileLibrary(library)).pipe(
      Effect.mapError(wrapDataError),
    );
    return library;
  });

  const load = SynchronizedRef.modifyEffect(libraryRef, () =>
    readLibraryFromFile.pipe(
      Effect.map((library) => [library, library] as const),
    ),
  );

  const get = SynchronizedRef.get(libraryRef).pipe(
    Effect.flatMap((current) =>
      current === null ? load : Effect.succeed(current),
    ),
  );

  const publish = (library: CombatProfileLibrary): Effect.Effect<void> =>
    Effect.sync(() => {
      for (const listener of listeners) {
        listener(library);
      }
    });

  const writeLibraryFile = (
    library: CombatProfileLibrary,
  ): Effect.Effect<CombatProfileLibrary, DesktopCombatProfilesError> => {
    const normalized = normalizeCombatProfileLibrary(library);
    return writeJsonFile(path, serializeCombatProfileLibrary(normalized)).pipe(
      Effect.mapError(wrapDataError),
      Effect.as(normalized),
    );
  };

  const update = (
    modify: (
      current: CombatProfileLibrary,
    ) => Effect.Effect<CombatProfileLibrary, DesktopCombatProfilesError>,
  ) =>
    SynchronizedRef.modifyEffect(libraryRef, (current) =>
      (current === null ? readLibraryFromFile : Effect.succeed(current)).pipe(
        Effect.flatMap(modify),
        Effect.flatMap(writeLibraryFile),
        Effect.map((saved) => [saved, saved] as const),
      ),
    ).pipe(Effect.tap(publish));

  return DesktopCombatProfiles.of({
    deleteProfile: (profileId) =>
      update((current) => deleteProfileFromLibrary(current, profileId)),
    get,
    load,
    onChanged: (listener) =>
      Effect.sync(() => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      }),
    saveProfile: (profile) =>
      update((current) =>
        Effect.succeed(saveProfileToLibrary(current, profile)),
      ),
  });
});

export const layer = Layer.effect(
  DesktopCombatProfiles,
  makeDesktopCombatProfiles,
);
