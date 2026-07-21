import {
  EntityState,
  orderMonstersByPriority,
  toMonsterSelector,
} from "@lucent/game";
import type { ItemQuery, MonsterQuery } from "@lucent/game";
import {
  normalizeCombatProfile,
  type CombatProfile,
  type CombatProfileDefinition,
} from "@lucent/core/combatProfiles";
import { Clock, Context, Effect, Option, Schema, Semaphore } from "effect";
import type { Duration } from "effect";

import {
  castCombatProfileMessageTriggers,
  castNextCombatProfileStep,
  makeCombatProfileCursor,
  makeCombatProfileMessageTriggerState,
  makeCombatProfileRuntimeDeps,
  resetCombatProfileCursor,
  type CombatProfileCursor,
  type CombatProfileMessageTriggerState,
  type CombatProfileRuntimeDeps,
} from "../../combatProfiles";
import type { BridgeService } from "../bridge/Bridge";
import {
  NonNegativeWireInt,
  PositiveWireInt,
  WireBoolean,
  WireInt,
} from "../contract/Coercion";
import { packetData } from "../contract/Packet";
import { decodeCombatActionAcknowledgements } from "../contract/payload/Combat";
import { isCounterAttackAura } from "../domain/AntiCounter";
import type { Store } from "../state/Store";
import type { Inventory } from "./Inventory";
import type { Drops } from "./Drops";
import type { Events } from "./Events";
import type { Map } from "./Map";
import type { Monsters } from "./Monsters";
import type { Player } from "./Player";
import type { Players } from "./Players";
import type { Settings } from "./Settings";
import type { TempInventory } from "./TempInventory";
import type { Wait } from "./Wait";

export type Skill = number;

export const CONSUMABLE_CAST_CONFIRMATION_TIMEOUT_MS = 5_000;
export const ConsumableCastDispatchDeadline = Context.Reference<
  number | undefined
>("lucent/game/combat/ConsumableCastDispatchDeadline", {
  defaultValue: () => undefined,
});

export interface HuntOptions {
  readonly findMost?: boolean;
}

export interface SkillUseOptions {
  readonly force?: boolean;
  readonly wait?: boolean;
}

export interface CombatKillOptions {
  readonly killPriority?: readonly MonsterQuery[];
  readonly profile?: CombatProfileDefinition;
  readonly skillDelay?: number;
  readonly skillSet?: readonly Skill[];
}

/** Retains local dispatch identity because rejected acknowledgements omit their target. */
export interface ConsumableCastResult {
  readonly actionId: number;
  readonly monsterMapId: number;
  readonly success: boolean;
}

const Consumable = Schema.NullOr(
  Schema.Struct({
    itemId: Schema.optionalKey(WireInt),
    ItemID: Schema.optionalKey(WireInt),
  }),
);
const ConsumableCastDispatch = Schema.NullOr(
  Schema.Struct({
    actionId: NonNegativeWireInt,
    itemId: PositiveWireInt,
    monsterMapId: PositiveWireInt,
  }),
);
const EntityStatePayload = WireInt.check(
  Schema.isBetween({
    minimum: EntityState.Dead,
    maximum: EntityState.InCombat,
  }),
);
const TargetPayload = Schema.NullOr(
  Schema.Union([
    Schema.Struct({
      cell: Schema.String,
      hp: WireInt,
      level: WireInt,
      maxHp: WireInt,
      monsterId: WireInt,
      monsterMapId: WireInt,
      name: Schema.String,
      race: Schema.String,
      state: EntityStatePayload,
      type: Schema.Literal("monster"),
    }),
    Schema.Struct({
      afk: WireBoolean,
      cell: Schema.String,
      entityId: WireInt,
      entityType: Schema.String,
      hp: WireInt,
      level: WireInt,
      maxHp: WireInt,
      maxMp: WireInt,
      mp: WireInt,
      name: Schema.String,
      pad: Schema.String,
      sp: WireInt,
      state: EntityStatePayload,
      type: Schema.Literal("player"),
      username: Schema.String,
    }),
  ]),
);

const skillIndex = (skill: Skill): number | null => {
  return Number.isInteger(skill) && skill >= 0 && skill <= 5 ? skill : null;
};

const DEFAULT_SKILL_SET: readonly Skill[] = [1, 2, 3, 4];
const normalizeSkillSet = (
  input: CombatKillOptions["skillSet"],
): readonly Skill[] => {
  const skills = (input ?? []).filter((skill) => skillIndex(skill) !== null);
  return skills.length === 0 ? DEFAULT_SKILL_SET : skills;
};

const normalizeSkillDelay = (delay: number | undefined): number =>
  delay === undefined || !Number.isFinite(delay)
    ? 150
    : Math.max(0, Math.trunc(delay));

interface KillProfileRuntime {
  readonly cursor: CombatProfileCursor;
  readonly dependencies: CombatProfileRuntimeDeps;
  readonly messageState: CombatProfileMessageTriggerState;
  readonly profile: CombatProfile;
}

export const makeCombat = (
  bridge: BridgeService,
  store: Store,
  drops: Drops,
  events: Events,
  inventory: Inventory,
  map: Map,
  monsters: Monsters,
  player: Player,
  players: Players,
  settings: Settings,
  temporary: TempInventory,
  wait: Wait,
) => {
  // Overlap would race AQW's single consumable slot; the deadline also keeps
  // queue delay from producing a late cast.
  const consumableCasts = Semaphore.makeUnsafe(1);
  const targetValue = bridge
    .invoke("combat.getTarget", undefined, TargetPayload)
    .pipe(Effect.map(Option.getOrNull));
  const targetAuras = (options?: { kind?: "active" | "passive" }) =>
    targetValue.pipe(
      Effect.flatMap((target) => {
        if (target === null) return Effect.succeed([]);
        return target.type === "monster"
          ? store.world.getMonsterAuras(target.monsterMapId, options)
          : store.world.getPlayerAuras(target.entityId, options);
      }),
    );

  const getSkillCooldownRemaining = (index: number) =>
    bridge.invoke("combat.getSkillCooldownRemaining", [index], WireInt).pipe(
      Effect.map(
        Option.match({
          onNone: () => Number.MAX_SAFE_INTEGER,
          onSome: (remaining) => Math.max(0, Math.trunc(remaining)),
        }),
      ),
    );

  const castConsumableOnMonster = (
    selector: MonsterQuery,
    expectedItemId: number,
  ): Effect.Effect<ConsumableCastResult | null> =>
    consumableCasts.withPermit(
      Effect.gen(function* () {
        if (!Number.isInteger(expectedItemId) || expectedItemId <= 0) {
          return null;
        }

        let dispatch:
          | Exclude<typeof ConsumableCastDispatch.Type, null>
          | undefined;
        let confirmation: ConsumableCastResult | null = null;
        const projectedSourceId = yield* store.world.getSelfEntityId;
        const sourceId =
          projectedSourceId ??
          (yield* bridge
            .invoke("player.getUserId", undefined, PositiveWireInt)
            .pipe(Effect.map(Option.getOrNull)));
        if (sourceId === null) return null;

        // The waiter must exist first because AQW can acknowledge in the same
        // frame as dispatch.
        yield* wait.forPacket(
          {
            command: "ct",
            direction: "server",
            predicate: (candidate) => {
              if (dispatch === undefined) return false;
              const expectedActionId = dispatch.actionId;
              const matched = decodeCombatActionAcknowledgements(
                packetData(candidate),
              ).acknowledgements.find(
                (candidate) =>
                  candidate.actionId === expectedActionId &&
                  candidate.source.type === "player" &&
                  candidate.source.id === sourceId,
              );
              if (matched === undefined) return false;
              confirmation = {
                actionId: dispatch.actionId,
                monsterMapId: dispatch.monsterMapId,
                success: matched.outcome === 1,
              };
              return true;
            },
            wireType: "json",
          },
          {
            timeout: `${CONSUMABLE_CAST_CONFIRMATION_TIMEOUT_MS} millis`,
            trigger: Effect.gen(function* () {
              const dispatchDeadline = yield* ConsumableCastDispatchDeadline;
              if (
                dispatchDeadline !== undefined &&
                (yield* Clock.currentTimeMillis) > dispatchDeadline
              ) {
                return false;
              }
              const result = yield* bridge
                .invoke(
                  "combat.castConsumableOnMonster",
                  [toMonsterSelector(selector), expectedItemId],
                  ConsumableCastDispatch,
                )
                .pipe(Effect.map(Option.getOrNull));
              if (result === null || result.itemId !== expectedItemId) {
                return false;
              }
              dispatch = result;
              return true;
            }),
          },
        );

        return confirmation;
      }),
    );

  const canUseSkill = (skill: Skill) => {
    const index = skillIndex(skill);
    return index === null
      ? Effect.succeed(false)
      : getSkillCooldownRemaining(index).pipe(
          Effect.map((remaining) => remaining === 0),
        );
  };

  const waitForSkillReady = (index: number) =>
    wait.until(
      getSkillCooldownRemaining(index).pipe(
        Effect.flatMap((remaining) =>
          remaining > 0
            ? Effect.sleep(remaining).pipe(Effect.as(false))
            : Effect.sleep("150 millis").pipe(
                Effect.andThen(getSkillCooldownRemaining(index)),
                Effect.map((confirmed) => confirmed === 0),
              ),
        ),
      ),
      { interval: "50 millis", timeout: "5 seconds" },
    );

  const antiCounterActive = (monsterMapId: number) =>
    settings
      .isAntiCounterEnabled()
      .pipe(
        Effect.flatMap((enabled) =>
          enabled
            ? store.world
                .getMonsterAuras(monsterMapId, { kind: "active" })
                .pipe(Effect.map((auras) => auras.some(isCounterAttackAura)))
            : Effect.succeed(false),
        ),
      );

  const stopCombat = Effect.all(
    [
      bridge.invoke("combat.cancelAutoAttack", undefined, Schema.Void),
      bridge.invoke("combat.cancelTarget", undefined, Schema.Void),
    ],
    { discard: true },
  ).pipe(Effect.asVoid);

  const useSkill = (skill: Skill, options?: SkillUseOptions) => {
    const index = skillIndex(skill);
    if (index === null) return Effect.succeed(false);
    return Effect.gen(function* () {
      if (!(yield* player.isAlive())) return false;
      const target = yield* targetValue;
      if (
        target?.type === "monster" &&
        (yield* antiCounterActive(target.monsterMapId))
      ) {
        yield* stopCombat;
        return false;
      }
      const ready =
        options?.wait === true
          ? yield* waitForSkillReady(index)
          : yield* canUseSkill(index);
      if (!ready || !(yield* player.isAlive())) return false;
      return yield* bridge
        .invoke(
          options?.force === true ? "combat.forceUseSkill" : "combat.useSkill",
          [String(index)],
          Schema.Boolean,
        )
        .pipe(Effect.map(Option.getOrElse(() => false)));
    });
  };

  const attackMonster = (selector: MonsterQuery) => {
    return Effect.gen(function* () {
      if (!(yield* player.isAlive())) return false;
      const monster = yield* monsters.get(selector);
      if (
        monster !== null &&
        (yield* antiCounterActive(monster.monsterMapId))
      ) {
        yield* stopCombat;
        return false;
      }
      return yield* bridge
        .invoke(
          "combat.attackMonster",
          [toMonsterSelector(selector)],
          Schema.Boolean,
        )
        .pipe(Effect.map(Option.getOrElse(() => false)));
    });
  };

  const hunt = (selector: MonsterQuery, options?: HuntOptions) => {
    return monsters.getAll().pipe(
      Effect.flatMap((all) => {
        const matches = all.filter((monster) => monster.matches(selector));
        if (options?.findMost !== true || matches.length < 2) {
          const target = matches[0] ?? null;
          return target === null || target.cell === ""
            ? Effect.succeed(target)
            : player.jumpToCell(target.cell).pipe(Effect.as(target));
        }
        const cells = new Map<string, number>();
        for (const monster of matches) {
          cells.set(monster.cell, (cells.get(monster.cell) ?? 0) + 1);
        }
        const target = matches.reduce((best, candidate) =>
          (cells.get(candidate.cell) ?? 0) > (cells.get(best.cell) ?? 0)
            ? candidate
            : best,
        );
        return target.cell === ""
          ? Effect.succeed(target)
          : player.jumpToCell(target.cell).pipe(Effect.as(target));
      }),
    );
  };

  const makeKillProfileRuntime = (
    definition: CombatProfileDefinition | undefined,
  ) => {
    if (definition === undefined) {
      return Effect.succeed<KillProfileRuntime | null>(null);
    }

    const profile = normalizeCombatProfile(definition);
    const dependencies = makeCombatProfileRuntimeDeps(
      { attackMonster, canUseSkill, target, useSkill },
      player,
      players,
    );
    return Effect.all({
      cursor: makeCombatProfileCursor(),
      messageState: makeCombatProfileMessageTriggerState(),
    }).pipe(
      Effect.map(
        ({ cursor, messageState }): KillProfileRuntime => ({
          cursor,
          dependencies,
          messageState,
          profile,
        }),
      ),
    );
  };

  const fight = (
    selector: MonsterQuery,
    options: CombatKillOptions | undefined,
    runtime: KillProfileRuntime | null,
  ) => {
    const skills = normalizeSkillSet(options?.skillSet);
    const skillDelay = normalizeSkillDelay(options?.skillDelay);
    const attackOrder = [...(options?.killPriority ?? []), selector];

    const selectTarget = Effect.gen(function* () {
      const available = yield* monsters.getAvailable();
      const candidates = orderMonstersByPriority(available, attackOrder);

      for (const candidate of candidates) {
        if (!(yield* antiCounterActive(candidate.monsterMapId)))
          return candidate;
      }

      return null;
    });

    return Effect.forever(
      Effect.gen(function* () {
        if (!(yield* player.isAlive())) {
          yield* Effect.sleep("250 millis");
          return;
        }

        const target = yield* selectTarget;
        if (target === null) {
          yield* stopCombat;
          yield* Effect.sleep("100 millis");
          return;
        }
        if (!(yield* attackMonster(target.monsterMapId))) {
          yield* Effect.sleep("250 millis");
          return;
        }

        if (runtime !== null) {
          const cast = yield* castNextCombatProfileStep(
            runtime.dependencies,
            runtime.profile,
            runtime.cursor,
          );
          yield* Effect.sleep(
            cast ? Math.max(50, runtime.profile.delayMs) : 250,
          );
          return;
        }

        for (const skill of skills) {
          yield* useSkill(skill);
          yield* Effect.sleep(skillDelay);
        }
      }),
    );
  };

  const killWithRuntime = (
    selector: MonsterQuery,
    options: CombatKillOptions | undefined,
    runtime: KillProfileRuntime | null,
  ) =>
    Effect.gen(function* () {
      const available = yield* monsters.getAvailable();
      const monster =
        available.find((candidate) => candidate.matches(selector)) ??
        orderMonstersByPriority(available, options?.killPriority ?? [])[0];
      if (monster === undefined) return false;

      const death = yield* wait.forEvent(
        {
          monsterMapId: monster.monsterMapId,
          type: "monster-death",
        },
        {
          trigger: Effect.forkScoped(fight(selector, options, runtime)).pipe(
            Effect.as(true),
          ),
        },
      );
      return death !== null;
    });

  const withProfileEvents = <A>(
    runtime: KillProfileRuntime | null,
    effect: Effect.Effect<A>,
  ) => {
    if (runtime === null) return effect;

    const subscriptions: Effect.Effect<() => void>[] = [];
    if ((runtime.profile.messageTriggers?.length ?? 0) > 0) {
      subscriptions.push(
        events.on({ type: "update-message" }, (event) => {
          if (event.type !== "update-message") return Effect.void;
          return castCombatProfileMessageTriggers(
            runtime.dependencies,
            runtime.profile,
            {
              message: event.message,
              ...(event.monsterMapId === undefined
                ? {}
                : { monMapId: event.monsterMapId }),
              source: event.source,
            },
            runtime.messageState,
          );
        }),
      );
    }
    if (runtime.profile.resetSkillIndexOnMonsterDeath === true) {
      subscriptions.push(
        events.on({ type: "monster-death" }, () =>
          resetCombatProfileCursor(runtime.cursor),
        ),
      );
    }
    if (subscriptions.length === 0) return effect;

    return Effect.acquireUseRelease(
      Effect.all(subscriptions),
      () => effect,
      (disposers) =>
        Effect.sync(() => {
          for (const dispose of disposers) dispose();
        }),
    );
  };

  const kill = (selector: MonsterQuery, options?: CombatKillOptions) =>
    makeKillProfileRuntime(options?.profile).pipe(
      Effect.flatMap((runtime) =>
        withProfileEvents(runtime, killWithRuntime(selector, options, runtime)),
      ),
      Effect.ensuring(stopCombat),
    );

  const killFor = (
    selector: MonsterQuery,
    item: ItemQuery,
    requested: number | undefined,
    source: Inventory | TempInventory,
    options?: CombatKillOptions,
  ) => {
    const wanted = Math.max(1, Math.trunc(requested ?? 1));
    return makeKillProfileRuntime(options?.profile).pipe(
      Effect.flatMap((runtime) => {
        const loop = Effect.gen(function* () {
          while (true) {
            if (yield* source.contains(item, wanted)) return true;
            if (yield* drops.contains(item)) {
              yield* drops.accept(item);
              if (yield* source.contains(item, wanted)) return true;
            }
            if (!(yield* killWithRuntime(selector, options, runtime))) {
              yield* Effect.sleep("100 millis");
            }
          }
        });

        return withProfileEvents(runtime, loop);
      }),
      Effect.ensuring(stopCombat),
    );
  };

  const cancelAutoAttack = () =>
    bridge
      .invoke("combat.cancelAutoAttack", undefined, Schema.Void)
      .pipe(Effect.asVoid);

  const cancelTarget = () =>
    bridge
      .invoke("combat.cancelTarget", undefined, Schema.Void)
      .pipe(Effect.asVoid);

  const waitUntilIdle = (timeout: Duration.Input) =>
    wait.until(
      player.getState().pipe(
        Effect.flatMap((state) =>
          state !== EntityState.Idle
            ? Effect.succeed(false)
            : Effect.sleep("500 millis").pipe(
                Effect.andThen(player.getState()),
                Effect.map((confirmed) => confirmed === EntityState.Idle),
              ),
        ),
      ),
      { interval: "100 millis", timeout },
    );

  const exit = () =>
    Effect.gen(function* () {
      if ((yield* player.getState()) === EntityState.Idle) return true;
      const currentCell = yield* player.getCell();
      const currentPad = yield* player.getPad();
      const monsterCells = new Set(
        (yield* monsters.getAll()).map((monster) => monster.cell.toLowerCase()),
      );
      const candidateCells = (yield* map.getCells())
        .filter((cell) => {
          const normalized = cell.trim().toLowerCase();
          return (
            normalized !== "" &&
            normalized !== "blank" &&
            normalized !== "wait" &&
            normalized !== currentCell.trim().toLowerCase()
          );
        })
        .toSorted(
          (left, right) =>
            Number(monsterCells.has(left.toLowerCase())) -
            Number(monsterCells.has(right.toLowerCase())),
        );

      for (const cell of candidateCells) {
        yield* stopCombat;
        if (yield* waitUntilIdle("1 second")) return true;
        yield* player.jumpToCell(cell);
        if (yield* waitUntilIdle("2 seconds")) return true;
      }

      for (let attempt = 0; attempt < 3; attempt += 1) {
        yield* stopCombat;
        yield* player.jumpToCell(currentCell, currentPad);
        if (yield* waitUntilIdle("2 seconds")) return true;
      }

      yield* stopCombat;
      return yield* waitUntilIdle("1 second");
    });

  const getConsumableSkillItem = () =>
    bridge.invoke("combat.getConsumableSkillItem", undefined, Consumable).pipe(
      Effect.map(
        Option.match({
          onNone: () => null,
          onSome: (item) => {
            const itemId = item?.itemId ?? item?.ItemID;
            return itemId === undefined ? null : { itemId };
          },
        }),
      ),
    );

  const killForItem = (
    selector: MonsterQuery,
    item: ItemQuery,
    quantity?: number,
    options?: CombatKillOptions,
  ) => killFor(selector, item, quantity, inventory, options);

  const killForTempItem = (
    selector: MonsterQuery,
    item: ItemQuery,
    quantity?: number,
    options?: CombatKillOptions,
  ) => killFor(selector, item, quantity, temporary, options);

  const getTargetAura = (
    name: string,
    options?: { kind?: "active" | "passive" },
  ) =>
    targetAuras(options).pipe(
      Effect.map(
        (auras) =>
          auras.find(
            (aura) =>
              aura.name.localeCompare(name, undefined, {
                sensitivity: "accent",
              }) === 0,
          ) ?? null,
      ),
    );

  const hasTargetAura = (
    name: string,
    options?: { kind?: "active" | "passive" },
  ) => getTargetAura(name, options).pipe(Effect.map((aura) => aura !== null));

  const getTarget = () => targetValue;

  const target = {
    auras: {
      get: getTargetAura,
      getAll: targetAuras,
      has: hasTargetAura,
    },
    get: getTarget,
  };

  return {
    attackMonster,
    cancelAutoAttack,
    cancelTarget,
    canUseSkill,
    castConsumableOnMonster,
    exit,
    getConsumableSkillItem,
    getSkillCooldownRemaining,
    hunt,
    kill,
    killForItem,
    killForTempItem,
    target,
    useSkill,
  };
};

export type Combat = ReturnType<typeof makeCombat>;
