import type {
  CombatProfile,
  CombatProfileLibrary,
} from "@lucent/core/combatProfiles";
import { getCombatProfileById } from "@lucent/core/combatProfiles";
import { EntityState } from "@lucent/game";
import type { Monster } from "@lucent/game";
import {
  Cause,
  Effect,
  FiberMap,
  Ref,
  Stream,
  SubscriptionRef,
  type FiberMap as FiberMapType,
} from "effect";

import type { ApiService } from "../flash/api/Api";
import { parseMonsterMapIdToken } from "../flash/domain/Selectors";
import {
  castCombatProfileMessageTrigger,
  castNextCombatProfileStep,
  makeCombatProfileMessageTriggerState,
  makeCombatProfileCursor,
  makeCombatProfileRuntimeDeps,
  matchesCombatProfileMessageTrigger,
} from "../combatProfiles";

export type AutoAttackTargetPriority =
  | { readonly kind: "monster-map-id"; readonly monsterMapId: number }
  | { readonly kind: "monster-name"; readonly name: string };

export interface AutoAttackStartOptions {
  readonly library: CombatProfileLibrary;
  readonly profileId: string;
  readonly targetPriority?: readonly AutoAttackTargetPriority[];
}

export interface AutoAttackState {
  readonly enabled: boolean;
  readonly lastError?: string;
  readonly profileId?: string;
  readonly profileLabel?: string;
  readonly running: boolean;
}

interface State {
  readonly enabled: boolean;
  readonly lastError: string | undefined;
  readonly profile: CombatProfile | undefined;
}

const key = "auto-attack";
const separator = /[,;\n]+/u;

export const parseAutoAttackTargetPriority = (
  value: string,
): readonly AutoAttackTargetPriority[] =>
  value
    .split(separator)
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => {
      const monsterMapId = parseMonsterMapIdToken(token);
      return monsterMapId === undefined
        ? { kind: "monster-name", name: token }
        : { kind: "monster-map-id", monsterMapId };
    });

const selectTarget = (
  monsters: readonly Monster[],
  priorities: readonly AutoAttackTargetPriority[],
) => {
  const available = monsters.filter(
    (monster) => monster.hp > 0 && monster.state !== EntityState.Dead,
  );
  for (const priority of priorities) {
    const target = available.find((monster) =>
      priority.kind === "monster-map-id"
        ? monster.monsterMapId === priority.monsterMapId
        : monster.name.localeCompare(priority.name, undefined, {
            sensitivity: "accent",
          }) === 0,
    );
    if (target !== undefined) return target;
  }
  return available[0];
};

const publicState = (state: State, running: boolean): AutoAttackState => ({
  enabled: state.enabled,
  running,
  ...(state.lastError === undefined ? {} : { lastError: state.lastError }),
  ...(state.profile === undefined
    ? {}
    : { profileId: state.profile.id, profileLabel: state.profile.label }),
});

export const makeAutoAttack = Effect.fnUntraced(function* (
  api: ApiService,
  fibers: FiberMapType.FiberMap<string>,
) {
  const state = yield* SubscriptionRef.make<State>({
    enabled: false,
    lastError: undefined,
    profile: undefined,
  });
  const messageState = yield* makeCombatProfileMessageTriggerState();
  const getState = () =>
    Effect.all({
      running: FiberMap.has(fibers, key),
      state: SubscriptionRef.get(state),
    }).pipe(Effect.map(({ running, state }) => publicState(state, running)));

  const changes = SubscriptionRef.changes(state).pipe(
    Stream.mapEffect((current) =>
      FiberMap.has(fibers, key).pipe(
        Effect.map((running) => publicState(current, running)),
      ),
    ),
  );

  const loop = (
    profile: CombatProfile,
    priorities: readonly AutoAttackTargetPriority[],
  ) =>
    Effect.gen(function* () {
      const cursor = yield* makeCombatProfileCursor();
      const deps = makeCombatProfileRuntimeDeps(
        api.combat,
        api.player,
        api.players,
      );
      while ((yield* SubscriptionRef.get(state)).enabled) {
        if (!(yield* api.player.isAlive())) {
          yield* Effect.sleep("250 millis");
          continue;
        }
        const target = selectTarget(
          yield* api.monsters.getAvailable(),
          priorities,
        );
        if (target === undefined) {
          yield* Effect.sleep("250 millis");
          continue;
        }
        const attacked = yield* api.combat.attackMonster(target.monsterMapId);
        const cast = attacked
          ? yield* castNextCombatProfileStep(deps, profile, cursor)
          : false;
        yield* Effect.sleep(
          attacked && cast ? Math.max(50, profile.delayMs) : 250,
        );
      }
    }).pipe(
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.void
          : SubscriptionRef.update(state, (current) => ({
              ...current,
              enabled: false,
              lastError:
                Cause.pretty(cause).split("\n")[0] ?? "Auto attack failed",
              profile: undefined,
            })),
      ),
      Effect.ensuring(
        Effect.all([api.combat.cancelAutoAttack(), api.combat.cancelTarget()], {
          discard: true,
        }),
      ),
    );

  const disable = () =>
    FiberMap.remove(fibers, key).pipe(
      Effect.andThen(Ref.set(messageState.state, new Map())),
      Effect.andThen(
        SubscriptionRef.set(state, {
          enabled: false,
          lastError: undefined,
          profile: undefined,
        }),
      ),
      Effect.andThen(getState()),
    );

  const enable = (options: AutoAttackStartOptions) => {
    const profile = getCombatProfileById(options.library, options.profileId);
    return SubscriptionRef.set(state, {
      enabled: true,
      lastError: undefined,
      profile,
    }).pipe(
      Effect.andThen(Ref.set(messageState.state, new Map())),
      Effect.andThen(
        FiberMap.run(fibers, key, loop(profile, options.targetPriority ?? [])),
      ),
      Effect.andThen(getState()),
    );
  };

  const isEnabled = () =>
    SubscriptionRef.get(state).pipe(Effect.map((current) => current.enabled));

  const disposeMessages = yield* api.events.on(
    { type: "update-message" },
    (event) =>
      Effect.gen(function* () {
        if (event.type !== "update-message") return;
        const current = yield* SubscriptionRef.get(state);
        const profile = current.profile;
        if (!current.enabled || profile === undefined) return;
        const message = {
          message: event.message,
          ...(event.monsterMapId === undefined
            ? {}
            : { monMapId: event.monsterMapId }),
          source: event.source,
        } as const;
        const dependencies = makeCombatProfileRuntimeDeps(
          api.combat,
          api.player,
          api.players,
        );
        for (const trigger of profile.messageTriggers ?? []) {
          if (!matchesCombatProfileMessageTrigger(trigger, message)) continue;
          yield* castCombatProfileMessageTrigger(
            dependencies,
            profile,
            trigger,
            message,
            messageState,
          );
        }
      }),
  );
  yield* Effect.addFinalizer(() => Effect.sync(disposeMessages));

  return {
    changes,
    disable,
    enable,
    getState,
    isEnabled,
  };
});

export type AutoAttack = Effect.Success<ReturnType<typeof makeAutoAttack>>;
