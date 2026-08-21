import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import * as Semaphore from "effect/Semaphore";

import type {
  CombatProfile,
  CombatProfileAuraCondition,
  CombatProfileCondition,
  CombatProfileMessageTrigger,
  CombatProfileStatCondition,
  CombatProfileStep,
} from "@lucent/core/combatProfiles";
import type { Aura } from "@lucent/game";
import type { ApiService } from "./flash/api/Api";

export interface CombatProfileCursor {
  readonly state: Ref.Ref<CombatProfileCursorState>;
}

export interface CombatProfileTargetTracker {
  readonly cursor: CombatProfileCursor;
  readonly monsterMapId: Ref.Ref<number | null>;
}

export interface CombatProfileMessageTriggerState {
  readonly semaphore: Semaphore.Semaphore;
  readonly state: Ref.Ref<ReadonlyMap<number, number>>;
}

export interface CombatProfileMessageTriggerEvent {
  readonly message: string;
  readonly monMapId?: number;
  readonly source: "animation" | "aura";
}

interface CombatProfileCursorState {
  readonly index: number;
  readonly resetVersion: number;
}

export interface CombatProfileRuntimeDeps {
  readonly combat: Pick<
    ApiService["combat"],
    "canUseSkill" | "getConsumableSkillItem" | "target" | "useSkill"
  >;
  readonly player: Pick<
    ApiService["player"],
    "auras" | "getHp" | "getMaxHp" | "getMaxMp" | "getMp"
  >;
  readonly players: Pick<ApiService["players"], "getAll" | "getMe">;
  /** When set, skill 5 only casts while this item is equipped and ready. */
  readonly skill5ItemId?: number;
}

export const makeCombatProfileRuntimeDeps = (
  combat: CombatProfileRuntimeDeps["combat"],
  player: CombatProfileRuntimeDeps["player"],
  players: CombatProfileRuntimeDeps["players"],
  skill5ItemId?: number,
): CombatProfileRuntimeDeps => ({
  combat,
  player,
  players,
  ...(skill5ItemId === undefined ? {} : { skill5ItemId }),
});

export const makeCombatProfileCursor = (): Effect.Effect<CombatProfileCursor> =>
  Effect.map(Ref.make({ index: 0, resetVersion: 0 }), (state) => ({ state }));

export const resetCombatProfileCursor = (
  cursor: CombatProfileCursor,
): Effect.Effect<void> =>
  Ref.update(cursor.state, (state) => ({
    index: 0,
    resetVersion: state.resetVersion + 1,
  }));

export const makeCombatProfileTargetTracker = Effect.fn(
  "makeCombatProfileTargetTracker",
)(function* (cursor: CombatProfileCursor) {
  return {
    cursor,
    monsterMapId: yield* Ref.make<number | null>(null),
  } satisfies CombatProfileTargetTracker;
});

const setCombatProfileTarget = (
  tracker: CombatProfileTargetTracker,
  monsterMapId: number,
): Effect.Effect<void> => Ref.set(tracker.monsterMapId, monsterMapId);

const clearCombatProfileTargetIfCurrent = (
  tracker: CombatProfileTargetTracker,
  monsterMapId: number,
): Effect.Effect<void> =>
  Ref.update(tracker.monsterMapId, (current) =>
    current === monsterMapId ? null : current,
  );

export const trackCombatProfileAttack = Effect.fn("trackCombatProfileAttack")(
  function* <E, R>(
    tracker: CombatProfileTargetTracker,
    monsterMapId: number,
    attack: Effect.Effect<boolean, E, R>,
  ): Effect.fn.Return<boolean, E, R> {
    yield* setCombatProfileTarget(tracker, monsterMapId);
    const attacked = yield* attack;
    if (!attacked) {
      yield* clearCombatProfileTargetIfCurrent(tracker, monsterMapId);
    }
    return attacked;
  },
);

export const resetCombatProfileOnTargetDeath = Effect.fn(
  "resetCombatProfileOnTargetDeath",
)(function* (tracker: CombatProfileTargetTracker, monsterMapId: number) {
  const targetDied = yield* Ref.modify(
    tracker.monsterMapId,
    (current): readonly [boolean, number | null] =>
      current === monsterMapId ? [true, null] : [false, current],
  );
  if (targetDied) {
    yield* resetCombatProfileCursor(tracker.cursor);
  }
});

export const makeCombatProfileMessageTriggerState =
  (): Effect.Effect<CombatProfileMessageTriggerState> =>
    Effect.gen(function* () {
      const state = yield* Ref.make<ReadonlyMap<number, number>>(new Map());
      const semaphore = yield* Semaphore.make(1);
      return {
        semaphore,
        state,
      };
    });

const compare = (
  actual: number,
  op: CombatProfileStatCondition["op"],
  expected: number,
): boolean => (op === ">=" ? actual >= expected : actual <= expected);

const statValue = (
  current: number,
  max: number,
  unit: CombatProfileStatCondition["unit"],
): number => (unit === "value" ? current : max > 0 ? (current / max) * 100 : 0);

const auraValue = (aura: Aura | null): number =>
  aura === null ? 0 : (aura.stack ?? aura.value ?? 1);

const matchesStatCondition = (
  deps: CombatProfileRuntimeDeps,
  condition: CombatProfileStatCondition,
) =>
  Effect.gen(function* () {
    if (condition.type === "self-hp") {
      const hp = yield* deps.player.getHp();
      const maxHp = yield* deps.player.getMaxHp();
      return compare(
        statValue(hp, maxHp, condition.unit),
        condition.op,
        condition.value,
      );
    }

    if (condition.type === "self-mp") {
      const mp = yield* deps.player.getMp();
      const maxMp = yield* deps.player.getMaxMp();
      return compare(
        statValue(mp, maxMp, condition.unit),
        condition.op,
        condition.value,
      );
    }

    const matchesPlayerHp = (hp: number, maxHp: number): boolean =>
      compare(
        statValue(hp, maxHp, condition.unit),
        condition.op,
        condition.value,
      );

    const self = yield* deps.players.getMe();
    if (self !== null && matchesPlayerHp(self.hp, self.maxHp)) {
      return true;
    }

    const selfEntityId = self?.entityId;
    const selfUsername = self?.username.trim().toLowerCase();
    for (const roomPlayer of yield* deps.players.getAll()) {
      if (
        (selfEntityId !== undefined && roomPlayer.entityId === selfEntityId) ||
        (selfUsername !== undefined &&
          roomPlayer.username.trim().toLowerCase() === selfUsername)
      ) {
        continue;
      }

      if (matchesPlayerHp(roomPlayer.hp, roomPlayer.maxHp)) {
        return true;
      }
    }

    return false;
  });

const getTargetAura = (
  deps: CombatProfileRuntimeDeps,
  condition: CombatProfileAuraCondition,
) =>
  Effect.gen(function* () {
    const target = yield* deps.combat.target.get();
    if (target === null) {
      return 0;
    }

    const aura =
      target.type === "monster"
        ? yield* deps.combat.target.auras.get(condition.auraName)
        : yield* deps.player.auras.get(condition.auraName);

    return auraValue(aura);
  });

const matchesAuraCondition = (
  deps: CombatProfileRuntimeDeps,
  condition: CombatProfileAuraCondition,
) =>
  Effect.gen(function* () {
    const actual =
      condition.type === "target-aura"
        ? yield* getTargetAura(deps, condition)
        : auraValue(yield* deps.player.auras.get(condition.auraName));

    return compare(actual, condition.op, condition.value);
  });

const matchesCondition = (
  deps: CombatProfileRuntimeDeps,
  condition: CombatProfileCondition,
) => {
  switch (condition.type) {
    case "self-aura":
    case "target-aura":
      return matchesAuraCondition(deps, condition);
    case "self-hp":
    case "self-mp":
    case "ally-hp":
      return matchesStatCondition(deps, condition);
  }
};

const isCombatProfileSkillAvailable = (
  deps: CombatProfileRuntimeDeps,
  skill: number,
) => {
  if (skill !== 5) {
    return Effect.succeed(true);
  }
  if (deps.skill5ItemId === undefined) return Effect.succeed(true);

  return deps.combat
    .getConsumableSkillItem()
    .pipe(
      Effect.map(
        (item) =>
          item !== null &&
          item.itemId === deps.skill5ItemId &&
          item.ready === true,
      ),
    );
};

export const matchesCombatProfileStep = (
  deps: CombatProfileRuntimeDeps,
  step: CombatProfileStep,
) =>
  Effect.gen(function* () {
    for (const condition of step.conditions) {
      if (!(yield* matchesCondition(deps, condition))) {
        return false;
      }
    }

    return true;
  });

interface PreparedCombatProfileStep {
  readonly waitForCooldown: boolean;
}

const prepareCombatProfileStep = Effect.fn("prepareCombatProfileStep")(
  function* (
    deps: CombatProfileRuntimeDeps,
    profile: CombatProfile,
    step: CombatProfileStep,
  ): Effect.fn.Return<PreparedCombatProfileStep | null> {
    if (!(yield* matchesCombatProfileStep(deps, step))) {
      return null;
    }
    if (!(yield* isCombatProfileSkillAvailable(deps, step.skill))) {
      return null;
    }

    const cooldownMode = step.cooldownMode ?? profile.cooldownMode;
    const waitForCooldown = cooldownMode === "wait-for-cooldown";
    if (!waitForCooldown && !(yield* deps.combat.canUseSkill(step.skill))) {
      return null;
    }

    return { waitForCooldown };
  },
);

const castPreparedCombatProfileStep = Effect.fn(
  "castPreparedCombatProfileStep",
)(function* (
  deps: CombatProfileRuntimeDeps,
  step: CombatProfileStep,
  prepared: PreparedCombatProfileStep,
): Effect.fn.Return<boolean> {
  const cast = yield* deps.combat.useSkill(step.skill, {
    wait: prepared.waitForCooldown,
  });
  if (cast && step.waitMs !== undefined && step.waitMs > 0) {
    yield* Effect.sleep(`${step.waitMs} millis`);
  }
  return cast;
});

export const castNextCombatProfileStep = Effect.fn("castNextCombatProfileStep")(
  function* (
    deps: CombatProfileRuntimeDeps,
    profile: CombatProfile,
    cursor: CombatProfileCursor,
  ): Effect.fn.Return<boolean> {
    const steps = profile.steps;
    if (steps.length === 0) {
      return false;
    }

    for (const step of steps) {
      if (step.priority !== true) {
        continue;
      }

      const prepared = yield* prepareCombatProfileStep(deps, profile, step);
      if (prepared === null) {
        continue;
      }

      return yield* castPreparedCombatProfileStep(deps, step, prepared);
    }

    const startState = yield* Ref.get(cursor.state);
    for (let offset = 0; offset < steps.length; offset += 1) {
      const stepIndex = (startState.index + offset) % steps.length;
      const step = steps[stepIndex];
      if (step === undefined) {
        continue;
      }

      const prepared = yield* prepareCombatProfileStep(deps, profile, step);
      if (prepared === null) {
        continue;
      }

      const resetVersionBeforeCast = (yield* Ref.get(cursor.state))
        .resetVersion;
      const cast = yield* castPreparedCombatProfileStep(deps, step, prepared);
      const nextIndex = (stepIndex + 1) % steps.length;
      yield* Ref.update(cursor.state, (state) =>
        state.resetVersion === resetVersionBeforeCast
          ? { ...state, index: nextIndex }
          : state,
      );

      return cast;
    }

    return false;
  },
);

const normalizeMessageTriggerText = (value: string): string =>
  value.trim().replace(/\s+/gu, " ").toLowerCase();

export const matchesCombatProfileMessageTriggerMessage = (
  configuredMessage: string,
  message: string,
): boolean => {
  const normalizedConfigured = normalizeMessageTriggerText(configuredMessage);
  return (
    normalizedConfigured !== "" &&
    normalizeMessageTriggerText(message).includes(normalizedConfigured)
  );
};

export const matchesCombatProfileMessageTrigger = (
  trigger: CombatProfileMessageTrigger,
  event: CombatProfileMessageTriggerEvent,
): boolean =>
  (trigger.source === "any" || trigger.source === event.source) &&
  matchesCombatProfileMessageTriggerMessage(
    trigger.messageIncludes,
    event.message,
  );

export const castCombatProfileMessageTrigger = (
  deps: CombatProfileRuntimeDeps,
  trigger: CombatProfileMessageTrigger,
  triggerIndex: number,
  event: CombatProfileMessageTriggerEvent,
  state: CombatProfileMessageTriggerState,
  now = Date.now(),
) =>
  state.semaphore.withPermits(1)(
    Effect.gen(function* () {
      const cooldownMs = trigger.cooldownMs ?? 0;
      const lastCast = (yield* Ref.get(state.state)).get(triggerIndex);
      if (lastCast !== undefined && now - lastCast < cooldownMs) {
        return false;
      }
      if (!(yield* isCombatProfileSkillAvailable(deps, trigger.skill))) {
        return false;
      }

      const cast = yield* deps.combat.useSkill(trigger.skill, {
        force: true,
        ...(event.monMapId === undefined ? {} : { target: event.monMapId }),
        wait: true,
      });
      if (!cast) {
        return false;
      }

      yield* Ref.update(state.state, (previous) => {
        const next = new Map(previous);
        next.set(triggerIndex, now);
        return next;
      });
      return true;
    }),
  );

export const castCombatProfileMessageTriggers = (
  deps: CombatProfileRuntimeDeps,
  profile: CombatProfile,
  event: CombatProfileMessageTriggerEvent,
  state: CombatProfileMessageTriggerState,
) =>
  Effect.gen(function* () {
    for (const [triggerIndex, trigger] of (
      profile.messageTriggers ?? []
    ).entries()) {
      if (!matchesCombatProfileMessageTrigger(trigger, event)) continue;
      yield* castCombatProfileMessageTrigger(
        deps,
        trigger,
        triggerIndex,
        event,
        state,
      );
    }
  });
