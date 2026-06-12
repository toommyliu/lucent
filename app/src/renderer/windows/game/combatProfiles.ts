import type { Aura, Monster } from "@lucent/game";
import { Effect, Option, Ref } from "effect";
import type {
  CombatProfile,
  CombatProfileAuraCondition,
  CombatProfileCondition,
  CombatProfileStatCondition,
  CombatProfileStep,
} from "../../../shared/combat-profiles";
import { Combat } from "./flash/Services/Combat";
import { Player } from "./flash/Services/Player";
import { World } from "./flash/Services/World";

export interface CombatProfileCursor {
  readonly state: Ref.Ref<CombatProfileCursorState>;
}

export interface CombatProfileAnimationTriggerState {
  readonly state: Ref.Ref<ReadonlyMap<string, number>>;
}

export interface CombatProfileAnimationTriggerEvent {
  readonly message: string;
  readonly monMapId?: number;
}

interface CombatProfileCursorState {
  readonly index: number;
  readonly resetVersion: number;
}

export const makeCombatProfileCursor = (): Effect.Effect<CombatProfileCursor> =>
  Effect.map(Ref.make({ index: 0, resetVersion: 0 }), (state) => ({ state }));

export const resetCombatProfileCursor = (
  cursor: CombatProfileCursor,
): Effect.Effect<void> =>
  Ref.update(cursor.state, (state) => ({
    index: 0,
    resetVersion: state.resetVersion + 1,
  }));

export const makeCombatProfileAnimationTriggerState =
  (): Effect.Effect<CombatProfileAnimationTriggerState> =>
    Effect.map(Ref.make<ReadonlyMap<string, number>>(new Map()), (state) => ({
      state,
    }));

const compare = (
  actual: number,
  op: CombatProfileStatCondition["op"],
  expected: number,
): boolean => (op === ">=" ? actual >= expected : actual <= expected);

const statValue = (
  current: number,
  max: number,
  unit: CombatProfileStatCondition["unit"],
): number => {
  if (unit === "value") {
    return current;
  }

  return max > 0 ? (current / max) * 100 : 0;
};

const auraValue = (aura: Aura | undefined): number =>
  aura === undefined ? 0 : (aura.stack ?? aura.value ?? 1);

const getSelfEntId = Effect.gen(function* () {
  const world = yield* World;
  return yield* world.players.withSelf((me) => me.data.entID);
});

const getTargetAura = (condition: CombatProfileAuraCondition) =>
  Effect.gen(function* () {
    const combat = yield* Combat;
    const world = yield* World;
    const target = yield* combat.target.get();

    if (Option.isNone(target)) {
      return 0;
    }

    if (target.value.type === "monster") {
      const aura = yield* world.monsters.getAura(
        target.value.monMapId,
        condition.auraName,
      );
      return auraValue(Option.isSome(aura) ? aura.value : undefined);
    }

    const aura = yield* world.players.getAura(
      target.value.entId,
      condition.auraName,
    );
    return auraValue(Option.isSome(aura) ? aura.value : undefined);
  });

const matchesStatCondition = (condition: CombatProfileStatCondition) =>
  Effect.gen(function* () {
    const player = yield* Player;
    const world = yield* World;

    if (condition.type === "self-hp") {
      const hp = yield* player.getHp();
      const maxHp = yield* player.getMaxHp();
      return compare(
        statValue(hp, maxHp, condition.unit),
        condition.op,
        condition.value,
      );
    }

    if (condition.type === "self-mp") {
      const mp = yield* player.getMp();
      const maxMp = yield* player.getMaxMp();
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

    const self = yield* world.players.withSelf((me) => ({
      entId: me.data.entID,
      hp: me.hp,
      maxHp: me.maxHp,
      username: me.username.toLowerCase(),
    }));

    if (
      Option.isSome(self) &&
      matchesPlayerHp(self.value.hp, self.value.maxHp)
    ) {
      return true;
    }

    const players = yield* world.players.getAll();
    for (const roomPlayer of players.values()) {
      if (
        Option.isSome(self) &&
        (roomPlayer.data.entID === self.value.entId ||
          roomPlayer.username.toLowerCase() === self.value.username)
      ) {
        continue;
      }

      if (matchesPlayerHp(roomPlayer.hp, roomPlayer.maxHp)) {
        return true;
      }
    }

    return false;
  });

const matchesAuraCondition = (condition: CombatProfileAuraCondition) =>
  Effect.gen(function* () {
    const world = yield* World;
    const actual =
      condition.type === "target-aura"
        ? yield* getTargetAura(condition)
        : yield* Effect.gen(function* () {
            const entId = yield* getSelfEntId;
            if (Option.isNone(entId)) {
              return 0;
            }

            const aura = yield* world.players.getAura(
              entId.value,
              condition.auraName,
            );
            return auraValue(Option.isSome(aura) ? aura.value : undefined);
          });

    return compare(actual, condition.op, condition.value);
  });

const matchesCondition = (condition: CombatProfileCondition) => {
  switch (condition.type) {
    case "self-aura":
    case "target-aura":
      return matchesAuraCondition(condition);
    case "self-hp":
    case "self-mp":
    case "ally-hp":
      return matchesStatCondition(condition);
  }
};

const matchesStep = (step: CombatProfileStep) =>
  Effect.gen(function* () {
    for (const condition of step.conditions) {
      if (!(yield* matchesCondition(condition))) {
        return false;
      }
    }

    return true;
  });

export const castNextCombatProfileStep = (
  profile: CombatProfile,
  cursor: CombatProfileCursor,
) =>
  Effect.gen(function* () {
    const combat = yield* Combat;
    const steps = profile.steps;
    if (steps.length === 0) {
      return false;
    }

    const startState = yield* Ref.get(cursor.state);
    const startIndex = startState.index;

    for (let offset = 0; offset < steps.length; offset += 1) {
      const stepIndex = (startIndex + offset) % steps.length;
      const step = steps[stepIndex];
      if (!step || !(yield* matchesStep(step))) {
        continue;
      }

      const cooldownMode = step.cooldownMode ?? profile.cooldownMode;
      const shouldWait = cooldownMode === "wait-for-cooldown";

      if (!shouldWait && !(yield* combat.canUseSkill(step.skill))) {
        continue;
      }

      const resetVersionBeforeCast = (yield* Ref.get(cursor.state))
        .resetVersion;
      yield* combat.useSkill(step.skill, false, shouldWait);
      const nextIndex = (stepIndex + 1) % steps.length;
      yield* Ref.update(cursor.state, (state) => {
        if (state.resetVersion !== resetVersionBeforeCast) {
          return state;
        }

        return {
          ...state,
          index: nextIndex,
        };
      });

      if (step.waitMs !== undefined && step.waitMs > 0) {
        yield* Effect.sleep(`${step.waitMs} millis`);
      }

      return true;
    }

    return false;
  });

export const isAttackableMonster = (monster: Monster): boolean =>
  monster.alive && !monster.isDead();

const normalizeAnimationTriggerText = (value: string): string =>
  value.trim().replace(/\s+/gu, " ").toLowerCase();

export const matchesCombatProfileAnimationTriggerMessage = (
  configuredMessage: string,
  message: string,
): boolean => {
  const normalizedConfiguredMessage =
    normalizeAnimationTriggerText(configuredMessage);
  if (normalizedConfiguredMessage === "") {
    return false;
  }

  return normalizeAnimationTriggerText(message).includes(
    normalizedConfiguredMessage,
  );
};

export const castCombatProfileAnimationTrigger = (
  profile: CombatProfile,
  trigger: NonNullable<CombatProfile["animationTriggers"]>[number],
  event: CombatProfileAnimationTriggerEvent,
  state: CombatProfileAnimationTriggerState,
  now = Date.now(),
) =>
  Effect.gen(function* () {
    const combat = yield* Combat;
    const cooldownMs = trigger.cooldownMs ?? 0;
    const castKey = `${profile.id}:${trigger.id}:${trigger.skill}`;
    const lastCast = (yield* Ref.get(state.state)).get(castKey);
    if (lastCast !== undefined && now - lastCast < cooldownMs) {
      return false;
    }

    if (event.monMapId !== undefined) {
      const targeted = yield* combat.attackMonster(event.monMapId);
      if (!targeted) {
        return false;
      }
    }

    yield* combat.useSkill(trigger.skill, true, true);
    yield* Ref.update(state.state, (previous) => {
      const next = new Map(previous);
      next.set(castKey, now);
      return next;
    });
    return true;
  });
