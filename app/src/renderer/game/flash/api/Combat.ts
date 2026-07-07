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
  Skill,
  TargetInfo,
} from "../Types";
import {
  DEFAULT_COMBAT_PROFILE_LIBRARY,
  getCombatProfileById,
  isCombatProfileDefinition,
  normalizeCombatProfile,
  normalizeCombatProfileLibrary,
} from "../../../../shared/combat-profiles";
import { SwfBridge } from "../SwfBridge";
import {
  antiCounterExpiresAtMs,
  isAntiCounterAura,
  isAntiCounterAuraName,
} from "../antiCounter";
import { monsterMatchesSelector, normalizeMonsterSelector } from "../selectors";
import { EventsApi } from "./Events";
import { InventoryApi } from "./Inventory";
import { MapApi } from "./Map";
import { MonstersApi } from "./Monsters";
import { PlayerApi } from "./Player";
import { PlayersApi } from "./Players";
import { SettingsApi } from "./Settings";
import { TempInventoryApi } from "./TempInventory";
import { WaitApi } from "./Wait";
import {
  castNextCombatProfileStep,
  makeCombatProfileRuntimeDeps,
  makeCombatProfileCursor,
  resetCombatProfileCursor,
} from "../../combatProfiles";

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
  readonly canUseSkill: (index: Skill) => Effect.Effect<boolean>;
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
    index: Skill,
    options?: SkillUseOptions,
  ) => Effect.Effect<boolean>;
}

export class CombatApi extends Context.Service<CombatApi, CombatApiShape>()(
  "lucent/game/flash/api/Combat",
) {}

const integerTokenPattern = /^[+-]?\d+$/u;

const normalizeSkill = (index: Skill): number | null => {
  const parsed =
    typeof index === "number"
      ? index
      : integerTokenPattern.test(index.trim())
        ? Number.parseInt(index.trim(), 10)
        : Number.NaN;
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 5 ? parsed : null;
};

const defaultSkillDelay = 150;
const combatExitSettleDelay = 500;
const skillReadyConfirmationDelay = 150;
const entityState = {
  dead: 0,
  inCombat: 2,
} as const;

interface TrackedAntiCounter {
  readonly auraName: string;
  readonly expiresAtMs: number;
}

interface MonsterTargetResolutionOptions extends HuntOptions {
  readonly includeDead: boolean;
}

const monsterTargetResolutionOptions = (
  options: HuntOptions | undefined,
  includeDead: boolean,
): MonsterTargetResolutionOptions =>
  options?.findMost === undefined
    ? { includeDead }
    : { findMost: options.findMost, includeDead };

const antiCounterAuraKey = (monsterMapId: number, auraName: string): string =>
  `${monsterMapId}:${auraName.trim().toLowerCase()}`;

const killTimeout = (options?: CombatKillOptions): Duration.Input =>
  options?.timeout ?? "60 seconds";

const skillSet = (options?: CombatKillOptions): readonly Skill[] => {
  const value = options?.skillSet;
  if (Array.isArray(value)) {
    const normalized = value.flatMap((skill): readonly Skill[] => {
      if (typeof skill === "string") {
        return skill
          .split(/[,\s]+/u)
          .map((token) => token.trim())
          .filter((token) => token !== "")
          .filter((token) => normalizeSkill(token) !== null);
      }

      return normalizeSkill(skill) === null ? [] : [skill];
    });
    return normalized.length > 0 ? normalized : [1, 2, 3, 4];
  }

  if (typeof value === "string") {
    const normalized = value
      .split(/[,\s]+/u)
      .map((token) => token.trim())
      .filter((token) => token !== "")
      .filter((token) => normalizeSkill(token) !== null);
    return normalized.length > 0 ? normalized : [1, 2, 3, 4];
  }

  return [1, 2, 3, 4];
};

const readCombatProfileLibraryFromDesktop = () =>
  Effect.promise(async () => {
    try {
      if (
        typeof window === "undefined" ||
        window.desktop.combatProfiles === undefined
      ) {
        return DEFAULT_COMBAT_PROFILE_LIBRARY;
      }

      return normalizeCombatProfileLibrary(
        await window.desktop.combatProfiles.getState(),
      );
    } catch {
      return DEFAULT_COMBAT_PROFILE_LIBRARY;
    }
  });

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

const isMonsterDead = (monster: MonsterRecord | null): boolean =>
  monster === null || monster.hp <= 0 || monster.state === entityState.dead;

const isCombatExitCandidateCell = (
  cell: string,
  currentCell: string,
): boolean => {
  const normalized = cell.trim().toLowerCase();
  return (
    normalized !== "" &&
    normalized !== currentCell.trim().toLowerCase() &&
    normalized !== "blank" &&
    normalized !== "wait" &&
    !/^cut\d+$/i.test(normalized)
  );
};

export const layer = Layer.effect(
  CombatApi,
  Effect.gen(function* () {
    const bridge = yield* SwfBridge;
    const events = yield* EventsApi;
    const inventory = yield* InventoryApi;
    const map = yield* MapApi;
    const monsters = yield* MonstersApi;
    const player = yield* PlayerApi;
    const players = yield* PlayersApi;
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

    const resolveCombatProfile = (profile: CombatKillOptions["profile"]) =>
      Effect.gen(function* () {
        if (profile === undefined) {
          return undefined;
        }

        if (isCombatProfileDefinition(profile)) {
          return normalizeCombatProfile(profile);
        }

        const library = yield* readCombatProfileLibraryFromDesktop();
        return getCombatProfileById(library, profile);
      });

    const antiCounterMonsters = new Map<number, TrackedAntiCounter>();
    const expiredAntiCounterAuraKeys = new Set<string>();
    const stoppedAntiCounterTargets = new Set<number>();

    const trackAntiCounterAura = (
      monsterMapId: number,
      aura: AuraRecord,
    ): void => {
      antiCounterMonsters.set(monsterMapId, {
        auraName: aura.name,
        expiresAtMs: antiCounterExpiresAtMs(aura),
      });
      expiredAntiCounterAuraKeys.delete(
        antiCounterAuraKey(monsterMapId, aura.name),
      );
    };

    const clearAntiCounterTracking = (monsterMapId: number): void => {
      antiCounterMonsters.delete(monsterMapId);
      stoppedAntiCounterTargets.delete(monsterMapId);

      const prefix = `${monsterMapId}:`;
      for (const key of expiredAntiCounterAuraKeys) {
        if (key.startsWith(prefix)) {
          expiredAntiCounterAuraKeys.delete(key);
        }
      }
    };

    const pruneExpiredAntiCounters = Effect.sync(() => {
      const now = Date.now();
      for (const [monsterMapId, tracked] of antiCounterMonsters) {
        if (tracked.expiresAtMs > now) {
          continue;
        }

        antiCounterMonsters.delete(monsterMapId);
        expiredAntiCounterAuraKeys.add(
          antiCounterAuraKey(monsterMapId, tracked.auraName),
        );
      }
    });

    const getProjectedAntiCounterAura = (monsterMapId: number) =>
      monsters.auras
        .getAll(monsterMapId)
        .pipe(
          Effect.map(
            (auras) => auras.find((aura) => isAntiCounterAura(aura)) ?? null,
          ),
        );

    const isAntiCounterActive = (monsterMapId: number) =>
      Effect.gen(function* () {
        yield* pruneExpiredAntiCounters;

        const projectedAura = yield* getProjectedAntiCounterAura(monsterMapId);
        if (projectedAura === null) {
          antiCounterMonsters.delete(monsterMapId);
          return false;
        }

        if (
          expiredAntiCounterAuraKeys.has(
            antiCounterAuraKey(monsterMapId, projectedAura.name),
          )
        ) {
          return false;
        }

        trackAntiCounterAura(monsterMapId, projectedAura);
        return true;
      });

    const isAntiCounterAvoidanceActive = (monsterMapId: number) =>
      Effect.gen(function* () {
        if (!(yield* settings.isAntiCounterEnabled())) {
          return false;
        }

        return yield* isAntiCounterActive(monsterMapId);
      });

    const getCurrentTargetMonsterMapId = () =>
      targetGet.pipe(
        Effect.map((target) =>
          target !== null && target.type === "monster"
            ? target.monsterMapId
            : undefined,
        ),
      );

    const stopCombat = Effect.gen(function* () {
      yield* bridge.call("combat.cancelAutoAttack");
      yield* bridge.call("combat.cancelTarget");
    });

    const stopAntiCounterCombat = (monsterMapId: number) =>
      Effect.gen(function* () {
        yield* stopCombat;
        stoppedAntiCounterTargets.add(monsterMapId);
      });

    const resolveAntiCounterMonsterMapIdForAttack = (
      normalized: NonNullable<ReturnType<typeof normalizeMonsterSelector>>,
    ) =>
      Effect.gen(function* () {
        const currentTarget = yield* targetGet;
        if (currentTarget !== null && currentTarget.type === "monster") {
          const matchesCurrentTarget =
            "monMapId" in normalized
              ? currentTarget.monsterMapId === normalized.monMapId
              : normalized.name === "*" ||
                currentTarget.name
                  .toLowerCase()
                  .includes(normalized.name.toLowerCase());

          if (
            matchesCurrentTarget &&
            (yield* isAntiCounterAvoidanceActive(currentTarget.monsterMapId))
          ) {
            return currentTarget.monsterMapId;
          }
        }

        if ("monMapId" in normalized) {
          return (yield* isAntiCounterAvoidanceActive(normalized.monMapId))
            ? normalized.monMapId
            : undefined;
        }

        const currentCell = (yield* player.getCell()).trim().toLowerCase();
        const candidates = (yield* monsters.getAll()).filter(
          (monster) =>
            !isMonsterDead(monster) &&
            monsterMatchesSelector(monster, normalized) &&
            (currentCell === "" ||
              monster.cell.trim().toLowerCase() === currentCell),
        );

        for (const monster of candidates) {
          if (yield* isAntiCounterAvoidanceActive(monster.monsterMapId)) {
            return monster.monsterMapId;
          }
        }

        return undefined;
      });

    const disposeAuraAdded = yield* events.on(
      { kind: "projection", type: "auraAdded" },
      (event) =>
        Effect.gen(function* () {
          if (event.type !== "auraAdded") {
            return;
          }

          const { aura, targetId, targetType } = event.payload;
          if (targetType !== "monster" || !isAntiCounterAura(aura)) {
            return;
          }

          trackAntiCounterAura(targetId, aura);
          if (!(yield* settings.isAntiCounterEnabled())) {
            return;
          }

          const currentTarget = yield* getCurrentTargetMonsterMapId();
          if (currentTarget === targetId) {
            yield* stopAntiCounterCombat(targetId);
          }
        }),
    );

    const disposeAuraRemoved = yield* events.on(
      { kind: "projection", type: "auraRemoved" },
      (event) =>
        Effect.gen(function* () {
          if (event.type !== "auraRemoved") {
            return;
          }

          const { auraName, targetId, targetType } = event.payload;
          if (targetType !== "monster" || !isAntiCounterAuraName(auraName)) {
            return;
          }

          antiCounterMonsters.delete(targetId);
          expiredAntiCounterAuraKeys.delete(
            antiCounterAuraKey(targetId, auraName),
          );
          const wasStopped = stoppedAntiCounterTargets.delete(targetId);
          if (!wasStopped || !(yield* settings.isAntiCounterEnabled())) {
            return;
          }

          if (!(yield* isAntiCounterActive(targetId))) {
            yield* bridge.call("combat.attackMonster", [
              { monMapId: targetId },
            ]);
          }
        }),
    );

    const disposeMonsterDeath = yield* events.on(
      { kind: "projection", type: "monsterDeath" },
      (event) =>
        Effect.sync(() => {
          if (event.type !== "monsterDeath") {
            return;
          }

          clearAntiCounterTracking(event.payload.monsterMapId);
        }),
    );

    const disposeJoinMap = yield* events.on(
      { kind: "projection", type: "joinMap" },
      () =>
        Effect.sync(() => {
          antiCounterMonsters.clear();
          expiredAntiCounterAuraKeys.clear();
          stoppedAntiCounterTargets.clear();
        }),
    );

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        disposeAuraAdded();
        disposeAuraRemoved();
        disposeMonsterDeath();
        disposeJoinMap();
      }),
    );

    const attackMonster: CombatApiShape["attackMonster"] = (selector) =>
      Effect.gen(function* () {
        const normalized = normalizeMonsterSelector(selector);
        if (normalized === null || !(yield* player.isAlive())) {
          return false;
        }

        const blockedMonsterMapId =
          yield* resolveAntiCounterMonsterMapIdForAttack(normalized);
        if (blockedMonsterMapId !== undefined) {
          yield* stopAntiCounterCombat(blockedMonsterMapId);
          return false;
        }

        yield* bridge.call("combat.attackMonster", [normalized]);
        return true;
      });

    const getSkillCooldownRemaining = (index: number) =>
      bridge
        .call("combat.getSkillCooldownRemaining", [index])
        .pipe(
          Effect.map((remaining) =>
            Number.isFinite(remaining) ? Math.max(0, Math.trunc(remaining)) : 0,
          ),
        );

    const waitForSkillReady = (index: number) =>
      Effect.gen(function* () {
        while (true) {
          const remaining = yield* getSkillCooldownRemaining(index);
          if (remaining > 0) {
            yield* Effect.sleep(remaining);
            continue;
          }

          yield* Effect.sleep(skillReadyConfirmationDelay);

          const confirmed = yield* getSkillCooldownRemaining(index);
          if (confirmed === 0) {
            return true;
          }
        }
      });

    const useSkill: CombatApiShape["useSkill"] = (index, options) =>
      Effect.gen(function* () {
        const skill = normalizeSkill(index);
        if (skill === null || !(yield* player.isAlive())) {
          return false;
        }

        const targetBeforeWait = yield* getCurrentTargetMonsterMapId();
        if (
          targetBeforeWait !== undefined &&
          (yield* isAntiCounterAvoidanceActive(targetBeforeWait))
        ) {
          yield* stopAntiCounterCombat(targetBeforeWait);
          return false;
        }

        if (options?.wait) {
          const ready = yield* wait.until(waitForSkillReady(skill), {
            timeout: "5 seconds",
          });
          if (!ready) {
            return false;
          }
        } else if (!(yield* canUseSkill(skill))) {
          return false;
        }

        if (!(yield* player.isAlive())) {
          return false;
        }

        const targetBeforeCast = yield* getCurrentTargetMonsterMapId();
        if (
          targetBeforeCast !== undefined &&
          (yield* isAntiCounterAvoidanceActive(targetBeforeCast))
        ) {
          yield* stopAntiCounterCombat(targetBeforeCast);
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
      Effect.gen(function* () {
        const skill = normalizeSkill(index);
        if (skill === null) {
          return false;
        }

        const remaining = yield* getSkillCooldownRemaining(skill);
        return remaining === 0;
      });

    const resolveMonsterTarget = (
      selector: MonsterSelector,
      options: MonsterTargetResolutionOptions,
    ) =>
      Effect.gen(function* () {
        const normalized = normalizeMonsterSelector(selector);
        if (normalized === null) {
          return null;
        }

        const matches = (yield* monsters.getAll()).filter(
          (monster) =>
            (options.includeDead || !isMonsterDead(monster)) &&
            monsterMatchesSelector(monster, normalized),
        );
        const monster = chooseHuntTarget(matches, options);
        if (monster === null) {
          return null;
        }

        if (monster.cell !== "") {
          yield* player.jumpToCell(monster.cell, undefined, true);
        }
        return monster;
      });

    const hunt: CombatApiShape["hunt"] = (selector, options) =>
      resolveMonsterTarget(
        selector,
        monsterTargetResolutionOptions(options, true),
      );

    const isPlayerInCombat = Effect.gen(function* () {
      const projectedState = yield* player.getState();
      return projectedState === entityState.inCombat;
    });

    const waitUntilOutOfCombat = (timeout: Duration.Input) =>
      wait.until(
        Effect.gen(function* () {
          if (yield* isPlayerInCombat) {
            return false;
          }

          yield* Effect.sleep(combatExitSettleDelay);
          return !(yield* isPlayerInCombat);
        }),
        {
          interval: "100 millis",
          timeout,
        },
      );

    const exitCombat = Effect.gen(function* () {
      const currentCell = yield* player.getCell();
      const currentPad = yield* player.getPad();
      const cellsWithMonsters = new Set(
        (yield* monsters.getAll()).map((monster) =>
          monster.cell.trim().toLowerCase(),
        ),
      );

      const candidates = (yield* map.getCells())
        .filter((cell) => isCombatExitCandidateCell(cell, currentCell))
        .toSorted((left, right) => {
          const leftHasMonsters = cellsWithMonsters.has(
            left.trim().toLowerCase(),
          );
          const rightHasMonsters = cellsWithMonsters.has(
            right.trim().toLowerCase(),
          );
          return leftHasMonsters === rightHasMonsters
            ? 0
            : leftHasMonsters
              ? 1
              : -1;
        });

      for (const cell of candidates) {
        yield* stopCombat;
        if (yield* waitUntilOutOfCombat("1 second")) {
          return true;
        }

        yield* player.jumpToCell(cell, undefined, true);
        if (yield* waitUntilOutOfCombat("2 seconds")) {
          return true;
        }
      }

      for (let attempts = 0; attempts < 3; attempts += 1) {
        yield* stopCombat;
        if (yield* waitUntilOutOfCombat("1 second")) {
          return true;
        }

        yield* player.jumpToCell(currentCell, currentPad, true);
        if (yield* waitUntilOutOfCombat("2 seconds")) {
          return true;
        }
      }

      yield* stopCombat;
      const exited = yield* waitUntilOutOfCombat("1 second");
      return exited;
    });

    const combatProfileRuntimeDeps = () =>
      makeCombatProfileRuntimeDeps(
        {
          attackMonster,
          canUseSkill,
          target: {
            auras: targetAuras,
            get: () => targetGet,
          },
          useSkill,
        },
        player,
        players,
      );

    const kill: CombatApiShape["kill"] = (selector, options) =>
      Effect.gen(function* () {
        if (normalizeMonsterSelector(selector) === null) {
          return false;
        }

        const timeout = killTimeout(options);
        const combatProfile = yield* resolveCombatProfile(options?.profile);
        const profileCursor =
          combatProfile === undefined
            ? undefined
            : yield* makeCombatProfileCursor();
        let target: MonsterRecord | null = null;
        const killed = yield* wait.until(
          Effect.gen(function* () {
            if (target !== null) {
              const current = yield* monsters.get({
                monMapId: target.monsterMapId,
              });
              if (isMonsterDead(current)) {
                if (
                  combatProfile?.resetSkillIndexOnMonsterDeath === true &&
                  profileCursor !== undefined
                ) {
                  yield* resetCombatProfileCursor(profileCursor);
                }
                return true;
              }
              target = current;
            }

            target ??= yield* resolveMonsterTarget(
              selector,
              monsterTargetResolutionOptions(options, false),
            );
            if (target === null) {
              return false;
            }

            if (yield* attackMonster({ monMapId: target.monsterMapId })) {
              if (combatProfile !== undefined && profileCursor !== undefined) {
                yield* castNextCombatProfileStep(
                  combatProfileRuntimeDeps(),
                  combatProfile,
                  profileCursor,
                );
              } else {
                for (const skill of skillSet(options)) {
                  yield* useSkill(skill, {
                    wait: options?.skillWait === true,
                  });
                  yield* Effect.sleep(options?.skillDelay ?? defaultSkillDelay);
                }
              }

              if (combatProfile !== undefined) {
                yield* Effect.sleep(combatProfile.delayMs);
              }
            }

            return false;
          }),
          { interval: "250 millis", timeout },
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
      exit: () => exitCombat,
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
