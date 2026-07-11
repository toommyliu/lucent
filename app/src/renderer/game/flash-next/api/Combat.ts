import { Effect, Option, Schema } from "effect";

import type { BridgeService } from "../bridge/Bridge";
import type {
  CombatKillOptions,
  HuntOptions,
  Skill,
  SkillUseOptions,
} from "../contract/Api";
import { WireInt } from "../contract/Coercion";
import { decodeMonsterSelector } from "../domain/Selectors";
import type { Store } from "../state/Store";
import type { Inventory } from "./Inventory";
import type { Monsters } from "./Monsters";
import type { Player } from "./Player";
import type { TempInventory } from "./TempInventory";
import type { Wait } from "./Wait";

const Consumable = Schema.NullOr(
  Schema.Struct({
    itemId: Schema.optionalKey(WireInt),
    ItemID: Schema.optionalKey(WireInt),
  }),
);

const skillIndex = (skill: Skill): number | null => {
  const parsed = typeof skill === "number" ? skill : Number(skill.trim());
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 5 ? parsed : null;
};

const skillSet = (input: CombatKillOptions["skillSet"]): readonly Skill[] => {
  if (Array.isArray(input)) return input.length === 0 ? [1, 2, 3, 4] : input;
  if (typeof input === "string") {
    const skills = input.split(/[^0-9]+/).filter(Boolean);
    return skills.length === 0 ? [1, 2, 3, 4] : skills;
  }
  return [1, 2, 3, 4];
};

export const makeCombat = (
  bridge: BridgeService,
  store: Store,
  inventory: Inventory,
  monsters: Monsters,
  player: Player,
  temporary: TempInventory,
  wait: Wait,
) => {
  const targetGet = Effect.gen(function* () {
    const combat = yield* store.combat.get;
    if (combat.target === null) return null;
    return combat.target.type === "monster"
      ? yield* store.world.getMonster(combat.target.id)
      : yield* store.world.getPlayer(combat.target.id);
  });
  const targetAuras = (options?: { kind?: "active" | "passive" }) =>
    store.combat.get.pipe(
      Effect.flatMap((combat) => {
        if (combat.target === null) return Effect.succeed([]);
        return combat.target.type === "monster"
          ? store.world.getMonsterAuras(combat.target.id, options)
          : store.world.getPlayerAuras(combat.target.id, options);
      }),
    );

  const canUseSkill = (skill: Skill) => {
    const index = skillIndex(skill);
    return index === null
      ? Effect.succeed(false)
      : Effect.all([
          bridge
            .invoke("combat.getSkillCooldownRemaining", [index], WireInt)
            .pipe(Effect.map(Option.getOrElse(() => Number.MAX_SAFE_INTEGER))),
          wait.isGameActionAvailable(`skill${index}`),
        ]).pipe(
          Effect.map(([cooldown, available]) => cooldown <= 0 && available),
        );
  };

  const useSkill = (skill: Skill, options?: SkillUseOptions) => {
    const index = skillIndex(skill);
    if (index === null) return Effect.succeed(false);
    const invoke = bridge
      .invoke(
        options?.force === true ? "combat.forceUseSkill" : "combat.useSkill",
        [String(index)],
        Schema.Boolean,
      )
      .pipe(Effect.map(Option.getOrElse(() => false)));
    return options?.wait === false || options?.force === true
      ? invoke
      : wait
          .until(canUseSkill(index), { timeout: "10 seconds" })
          .pipe(
            Effect.flatMap((ready) => (ready ? invoke : Effect.succeed(false))),
          );
  };

  const hunt = (selector: unknown, options?: HuntOptions) => {
    const decoded = decodeMonsterSelector(selector);
    if (Option.isNone(decoded)) return Effect.succeed(null);
    return monsters.getAvailable().pipe(
      Effect.map((available) => {
        const matches = available.filter((monster) =>
          monster.matches(decoded.value),
        );
        if (options?.findMost !== true || matches.length < 2) {
          return matches[0] ?? null;
        }
        const cells = new Map<string, number>();
        for (const monster of matches) {
          cells.set(monster.cell, (cells.get(monster.cell) ?? 0) + 1);
        }
        return matches.reduce((best, candidate) =>
          (cells.get(candidate.cell) ?? 0) > (cells.get(best.cell) ?? 0)
            ? candidate
            : best,
        );
      }),
    );
  };

  const kill = (selector: unknown, options?: CombatKillOptions) => {
    const decoded = decodeMonsterSelector(selector);
    if (Option.isNone(decoded)) return Effect.succeed(false);
    const skills = skillSet(options?.skillSet);
    const cycle = Effect.gen(function* () {
      const monster = yield* hunt(decoded.value);
      if (monster === null) return false;
      const me = yield* player.get();
      if (me !== null && monster.cell !== "" && me.cell !== monster.cell) {
        yield* player.jumpToCell(monster.cell);
      }
      const attacked = yield* bridge
        .invoke("combat.attackMonster", [decoded.value], Schema.Boolean)
        .pipe(Effect.map(Option.getOrElse(() => false)));
      if (!attacked) return false;

      const fight: Effect.Effect<boolean> = Effect.suspend(() => {
        if (!monster.alive) return Effect.succeed(true);
        return Effect.forEach(skills, (skill) => useSkill(skill), {
          discard: true,
        }).pipe(
          Effect.andThen(Effect.sleep(options?.skillDelay ?? 250)),
          Effect.flatMap(() => fight),
        );
      });
      return yield* fight;
    });
    return cycle.pipe(
      Effect.timeoutOption(options?.timeout ?? "60 seconds"),
      Effect.map(Option.getOrElse(() => false)),
    );
  };

  const killFor = (
    selector: unknown,
    item: unknown,
    requested: number | undefined,
    source: Inventory | TempInventory,
    options?: CombatKillOptions,
  ) => {
    const wanted = Math.max(1, Math.trunc(requested ?? 1));
    const maxKills = Math.max(1, Math.trunc(options?.maxKills ?? 100));
    const loop = (kills: number): Effect.Effect<boolean> =>
      source
        .contains(item, wanted)
        .pipe(
          Effect.flatMap((done) =>
            done
              ? Effect.succeed(true)
              : kills >= maxKills
                ? Effect.succeed(false)
                : kill(selector, options).pipe(
                    Effect.flatMap((killed) =>
                      killed ? loop(kills + 1) : Effect.succeed(false),
                    ),
                  ),
          ),
        );
    return loop(0);
  };

  return {
    attackMonster: (selector: unknown) => {
      const decoded = decodeMonsterSelector(selector);
      return Option.isNone(decoded)
        ? Effect.succeed(false)
        : bridge
            .invoke("combat.attackMonster", [decoded.value], Schema.Boolean)
            .pipe(Effect.map(Option.getOrElse(() => false)));
    },
    cancelAutoAttack: () =>
      bridge
        .invoke("combat.cancelAutoAttack", undefined, Schema.Void)
        .pipe(Effect.asVoid),
    cancelTarget: () =>
      bridge
        .invoke("combat.cancelTarget", undefined, Schema.Void)
        .pipe(Effect.andThen(store.combat.setTarget(null)), Effect.asVoid),
    canUseSkill,
    exit: () =>
      bridge.invoke("combat.cancelTarget", undefined, Schema.Void).pipe(
        Effect.flatMap(
          Option.match({
            onNone: () => Effect.succeed(false),
            onSome: () =>
              wait.until(
                player.get().pipe(Effect.map((current) => !current?.inCombat)),
                { timeout: "5 seconds" },
              ),
          }),
        ),
      ),
    getConsumableSkillItem: () =>
      bridge
        .invoke("combat.getConsumableSkillItem", undefined, Consumable)
        .pipe(
          Effect.map(
            Option.match({
              onNone: () => null,
              onSome: (item) => {
                const itemId = item?.itemId ?? item?.ItemID;
                return itemId === undefined ? null : { itemId };
              },
            }),
          ),
        ),
    hunt,
    kill,
    killForItem: (
      selector: unknown,
      item: unknown,
      quantity?: number,
      options?: CombatKillOptions,
    ) => killFor(selector, item, quantity, inventory, options),
    killForTempItem: (
      selector: unknown,
      item: unknown,
      quantity?: number,
      options?: CombatKillOptions,
    ) => killFor(selector, item, quantity, temporary, options),
    target: {
      auras: {
        get: (name: string, options?: { kind?: "active" | "passive" }) =>
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
          ),
        getAll: targetAuras,
        has: (name: string, options?: { kind?: "active" | "passive" }) =>
          targetAuras(options).pipe(
            Effect.map((auras) =>
              auras.some(
                (aura) =>
                  aura.name.localeCompare(name, undefined, {
                    sensitivity: "accent",
                  }) === 0,
              ),
            ),
          ),
      },
      get: () => targetGet,
    },
    useSkill,
  };
};

export type Combat = ReturnType<typeof makeCombat>;
