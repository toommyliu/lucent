import { Context, Effect, Layer } from "effect";
import type { Duration } from "effect";

import type {
  AuraRecord,
  CombatKillOptions,
  HuntOptions,
  ItemSelector,
  MonsterRecord,
  MonsterSelector,
  SkillUseOptions,
  TargetInfo,
} from "../Types";
import { SwfBridge } from "../SwfBridge";
import { normalizeMonsterSelector } from "../selectors";
import { InventoryApi } from "./Inventory";
import { MonstersApi } from "./Monsters";
import { PlayerApi } from "./Player";
import { SettingsApi } from "./Settings";
import { TempInventoryApi } from "./TempInventory";
import { WaitApi } from "./Wait";

export interface CombatTargetApi {
  readonly auras: TargetAurasApi;
  readonly get: () => Effect.Effect<TargetInfo | null>;
}

export interface TargetAurasApi {
  readonly get: (auraName: string) => Effect.Effect<AuraRecord | null>;
  readonly getAll: () => Effect.Effect<readonly AuraRecord[]>;
  readonly has: (auraName: string) => Effect.Effect<boolean>;
}

export interface CombatApiShape {
  readonly attackMonster: (selector: MonsterSelector) => Effect.Effect<boolean>;
  readonly cancelAutoAttack: () => Effect.Effect<void>;
  readonly cancelTarget: () => Effect.Effect<void>;
  readonly canUseSkill: (index: number) => Effect.Effect<boolean>;
  readonly exit: () => Effect.Effect<boolean>;
  readonly getConsumableSkillItem: () => Effect.Effect<{
    readonly itemId: number;
  } | null>;
  readonly hunt: (
    selector: MonsterSelector,
    options?: HuntOptions,
  ) => Effect.Effect<MonsterRecord | null>;
  readonly kill: (
    selector: MonsterSelector,
    options?: CombatKillOptions,
  ) => Effect.Effect<boolean>;
  readonly killForItem: (
    monster: MonsterSelector,
    item: ItemSelector,
    quantity?: number,
    options?: CombatKillOptions,
  ) => Effect.Effect<boolean>;
  readonly killForTempItem: (
    monster: MonsterSelector,
    item: ItemSelector,
    quantity?: number,
    options?: CombatKillOptions,
  ) => Effect.Effect<boolean>;
  readonly target: CombatTargetApi;
  readonly useSkill: (
    index: number,
    options?: SkillUseOptions,
  ) => Effect.Effect<boolean>;
}

export class CombatApi extends Context.Service<CombatApi, CombatApiShape>()(
  "lucent/game/flash/api/Combat",
) {}

const normalizeSkill = (index: number): number | null =>
  Number.isInteger(index) && index >= 0 && index <= 5 ? index : null;

const killTimeout = (options?: CombatKillOptions): Duration.Input =>
  options?.timeout ?? "60 seconds";

const skillSet = (options?: CombatKillOptions): readonly number[] => {
  if (Array.isArray(options?.skillSet)) {
    return options.skillSet;
  }

  return [1, 2, 3, 4];
};

const chooseHuntTarget = (
  matches: readonly MonsterRecord[],
  options?: HuntOptions,
): MonsterRecord | null => {
  if (matches.length === 0) {
    return null;
  }

  if (options?.findMost !== true) {
    return matches[0] ?? null;
  }

  const cellCounts = new Map<string, number>();
  for (const monster of matches) {
    cellCounts.set(monster.cell, (cellCounts.get(monster.cell) ?? 0) + 1);
  }

  let best = matches[0] ?? null;
  let bestCount = best === null ? 0 : (cellCounts.get(best.cell) ?? 0);
  for (const monster of matches.slice(1)) {
    const count = cellCounts.get(monster.cell) ?? 0;
    if (count > bestCount) {
      best = monster;
      bestCount = count;
    }
  }

  return best;
};

export const layer = Layer.effect(
  CombatApi,
  Effect.gen(function* () {
    const bridge = yield* SwfBridge;
    const inventory = yield* InventoryApi;
    const monsters = yield* MonstersApi;
    const player = yield* PlayerApi;
    const settings = yield* SettingsApi;
    const tempInventory = yield* TempInventoryApi;
    const wait = yield* WaitApi;

    const targetGet = bridge.call("combat.getTarget");

    const targetAuras: TargetAurasApi = {
      get: (auraName) =>
        targetGet.pipe(
          Effect.flatMap((target) => {
            if (target === null) {
              return Effect.succeed(null);
            }
            return target.type === "monster"
              ? monsters.auras.get(target.monsterMapId, auraName)
              : player.auras.get(auraName);
          }),
        ),
      getAll: () =>
        targetGet.pipe(
          Effect.flatMap((target) => {
            if (target === null) {
              return Effect.succeed([]);
            }
            return target.type === "monster"
              ? monsters.auras.getAll(target.monsterMapId)
              : player.auras.getAll();
          }),
        ),
      has: (auraName) =>
        targetAuras.get(auraName).pipe(Effect.map((aura) => aura !== null)),
    };

    const attackMonster: CombatApiShape["attackMonster"] = (selector) =>
      Effect.gen(function* () {
        const normalized = normalizeMonsterSelector(selector);
        if (normalized === null || !(yield* player.isAlive())) {
          return false;
        }

        const antiCounter = yield* settings.isAntiCounterEnabled();
        if (antiCounter) {
          // TODO: replace name-based counter detection with exact aura metadata when projected.
          const monster = yield* monsters.get(selector);
          if (monster !== null) {
            const auras = yield* monsters.auras.getAll(monster.monsterMapId);
            if (
              auras.some((aura) => aura.name.toLowerCase().includes("counter"))
            ) {
              return false;
            }
          }
        }

        yield* bridge.call("combat.attackMonster", [normalized]);
        return true;
      });

    const useSkill: CombatApiShape["useSkill"] = (index, options) =>
      Effect.gen(function* () {
        const skill = normalizeSkill(index);
        if (skill === null || !(yield* player.isAlive())) {
          return false;
        }

        if (options?.wait) {
          const ready = yield* wait.until(canUseSkill(skill), {
            timeout: "5 seconds",
          });
          if (!ready) {
            return false;
          }
        } else if (!(yield* canUseSkill(skill))) {
          return false;
        }

        if (options?.force) {
          yield* bridge.call("combat.forceUseSkill", [String(skill)]);
        } else {
          yield* bridge.call("combat.useSkill", [String(skill)]);
        }
        return true;
      });

    const canUseSkill: CombatApiShape["canUseSkill"] = (index) =>
      Number.isFinite(index)
        ? bridge
            .call("combat.getSkillCooldownRemaining", [Math.trunc(index)])
            .pipe(Effect.map((remaining) => remaining <= 0))
        : Effect.succeed(false);

    const hunt: CombatApiShape["hunt"] = (selector, options) =>
      Effect.gen(function* () {
        const normalized = normalizeMonsterSelector(selector);
        if (normalized === null) {
          return null;
        }

        const allMonsters = yield* monsters.getAll();
        const matches = allMonsters.filter((monster) => {
          if ("monMapId" in normalized) {
            return monster.monsterMapId === normalized.monMapId;
          }
          return monster.name
            .toLowerCase()
            .includes(normalized.name.toLowerCase());
        });
        const monster = chooseHuntTarget(matches, options);
        if (monster === null) {
          return null;
        }

        if (monster.cell !== "") {
          yield* player.jumpToCell(monster.cell, undefined, true);
        }
        return monster;
      });

    const stopCombat = Effect.gen(function* () {
      yield* bridge.call("combat.cancelAutoAttack");
      yield* bridge.call("combat.cancelTarget");
    });

    const kill: CombatApiShape["kill"] = (selector, options) =>
      Effect.gen(function* () {
        const initial = yield* hunt(selector, options);
        if (initial === null) {
          return false;
        }

        // TODO: settle kills on semantic monsterDeath events instead of polling projected hp/state.
        const killed = yield* wait.until(
          Effect.gen(function* () {
            const monster = yield* monsters.get(selector);
            if (monster === null || monster.hp <= 0 || monster.state === 0) {
              return true;
            }

            yield* attackMonster({ monMapId: monster.monsterMapId });
            for (const skill of skillSet(options)) {
              yield* useSkill(skill, { wait: options?.skillWait === true });
              yield* Effect.sleep(options?.skillDelay ?? 150);
            }
            return false;
          }),
          { interval: "250 millis", timeout: killTimeout(options) },
        );

        yield* stopCombat;
        return killed;
      });

    const killFor = (
      monster: MonsterSelector,
      item: ItemSelector,
      quantity: number | undefined,
      options: CombatKillOptions | undefined,
      contains: (
        item: ItemSelector,
        quantity?: number,
      ) => Effect.Effect<boolean>,
    ) =>
      wait.until(
        Effect.gen(function* () {
          if (yield* contains(item, quantity)) {
            return true;
          }
          return yield* kill(monster, options);
        }),
        { interval: "250 millis", timeout: killTimeout(options) },
      );

    return CombatApi.of({
      attackMonster,
      cancelAutoAttack: () => bridge.call("combat.cancelAutoAttack"),
      cancelTarget: () => bridge.call("combat.cancelTarget"),
      canUseSkill,
      exit: () =>
        Effect.gen(function* () {
          yield* stopCombat;
          return yield* wait.until(
            targetGet.pipe(Effect.map((target) => target === null)),
            { timeout: "5 seconds" },
          );
        }),
      getConsumableSkillItem: () =>
        bridge.call("combat.getConsumableSkillItem"),
      hunt,
      kill,
      killForItem: (monster, item, quantity, options) =>
        killFor(monster, item, quantity, options, inventory.contains),
      killForTempItem: (monster, item, quantity, options) =>
        killFor(monster, item, quantity, options, tempInventory.contains),
      target: {
        auras: targetAuras,
        get: () => targetGet,
      },
      useSkill,
    });
  }),
);
