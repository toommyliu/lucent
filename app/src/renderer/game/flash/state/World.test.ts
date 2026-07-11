import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { EntityState, LiveAura, LiveMonster, LivePlayer } from "@lucent/game";
import { WorldState, layer as WorldStateLayer } from "./World";

const player = (entityId: number, username: string, hp = 100): LivePlayer =>
  new LivePlayer({
    afk: false,
    cell: "Enter",
    entityId,
    entityType: "player",
    hp,
    level: 1,
    maxHp: 100,
    maxMp: 50,
    mp: 50,
    name: username,
    pad: "Spawn",
    position: { x: 0, y: 0 },
    state: hp > 0 ? EntityState.Idle : EntityState.Dead,
    username,
  });

const monster = (monsterMapId: number, name: string, hp = 100): LiveMonster =>
  new LiveMonster({
    cell: "Enter",
    hp,
    level: 1,
    maxHp: 100,
    maxMp: 20,
    monsterId: monsterMapId,
    monsterMapId,
    mp: 20,
    name,
    race: "None",
    state: hp > 0 ? EntityState.Idle : EntityState.Dead,
  });

const aura = (
  name: string,
  kind: "active" | "passive" = "active",
  duration = 5,
): LiveAura => new LiveAura({ duration, kind, name, stack: 1 });

describe("World state reconciliation", () => {
  it.effect("isolates aura kinds, targets, stacks, and mutation outcomes", () =>
    Effect.gen(function* () {
      const world = yield* WorldState;
      yield* world.addMonster(monster(1, "One"));
      yield* world.addMonster(monster(2, "Two"));

      const shared = aura("Focus");
      const firstAdd = yield* world.addAura("monster", 1, shared);
      yield* world.addAura("monster", 1, shared);
      yield* world.addAura("monster", 1, aura("Focus", "passive"));
      yield* world.addAura("monster", 2, shared);

      expect((yield* world.getMonsterAuras(1))[0]?.stack).toBe(2);
      expect(
        (yield* world.getMonsterAuras(1, { kind: "passive" }))[0]?.stack,
      ).toBe(1);
      expect((yield* world.getMonsterAuras(2))[0]?.stack).toBe(1);

      const refresh = yield* world.refreshAura(
        "monster",
        1,
        aura("Focus", "active", 9),
      );
      expect(refresh?.aura.duration).toBe(9);
      expect(refresh?.remainingStack).toBe(2);
      expect(firstAdd?.aura.duration).toBe(5);
      expect((yield* world.getMonsterAuras(2))[0]?.duration).toBe(5);
      const repeatedRefresh = yield* world.refreshAura(
        "monster",
        1,
        aura("Focus", "active", 9),
      );
      expect(repeatedRefresh?.aura.duration).toBe(9);

      const removals = yield* world.removeAura("monster", 1, "Focus");
      expect(removals).toEqual([
        { auraName: "Focus", kind: "active", remainingStack: 1 },
        { auraName: "Focus", kind: "passive", remainingStack: 0 },
      ]);
      expect((yield* world.getMonsterAuras(1))[0]?.stack).toBe(1);
      expect(yield* world.getMonsterAuras(1, { kind: "passive" })).toEqual([]);
    }).pipe(Effect.provide(WorldStateLayer)),
  );

  it.effect(
    "replaces area state authoritatively while retaining live entities",
    () =>
      Effect.gen(function* () {
        const world = yield* WorldState;
        const retainedPlayer = player(1, "Hero");
        const retainedMonster = monster(2, "Slime");
        const removedMonster = monster(3, "Removed");
        yield* world.replaceArea({
          map: { id: 1, name: "battleon", roomNumber: 1001 },
          monsters: [retainedMonster, removedMonster],
          players: [retainedPlayer],
          selfUsername: "Hero",
        });
        yield* world.addAura("player", 1, aura("Player Aura"));
        yield* world.addAura("monster", 2, aura("Monster Aura"));
        const stableMap = yield* world.getMap();

        yield* world.replaceArea({
          map: { id: 1, name: "battleon", roomNumber: 1001 },
          monsters: [monster(2, "Slime", 25)],
          players: [player(1, "Hero", 75)],
          selfUsername: "Hero",
        });

        expect(yield* world.getPlayer(1)).toBe(retainedPlayer);
        expect((yield* world.getPlayer(1))?.hp).toBe(75);
        expect(yield* world.getMonster(2)).toBe(retainedMonster);
        expect((yield* world.getMonster(2))?.hp).toBe(25);
        expect(yield* world.getMonster(3)).toBeNull();
        expect(removedMonster.hp).toBe(100);
        expect(yield* world.getPlayerAuras(1)).toEqual([]);
        expect(yield* world.getMonsterAuras(2)).toEqual([]);
        yield* world.patchMap({ roomNumber: 2002 });
        expect(stableMap).toEqual({
          id: 1,
          name: "battleon",
          roomNumber: 1001,
        });
      }).pipe(Effect.provide(WorldStateLayer)),
  );

  it.effect("registers sparse identity without replacing runtime state", () =>
    Effect.gen(function* () {
      const world = yield* WorldState;
      const hero = player(1, "Hero", 75);
      yield* world.addPlayer(hero);
      yield* world.addAura("player", 1, aura("Focus"));

      yield* world.registerPlayerIdentity("Hero", 42);

      expect(yield* world.getPlayer(42)).toBe(hero);
      expect(yield* world.getPlayer(1)).toBeNull();
      expect(hero.hp).toBe(75);
      expect(hero.cell).toBe("Enter");
      expect(hero.entityId).toBe(42);
      expect(yield* world.getPlayerAuras(1)).toEqual([]);
    }).pipe(Effect.provide(WorldStateLayer)),
  );

  it.effect("reduces combat state atomically and enforces death cleanup", () =>
    Effect.gen(function* () {
      const world = yield* WorldState;
      yield* world.replaceArea({
        map: { id: 1, name: "battleon", roomNumber: 1001 },
        monsters: [monster(2, "Slime")],
        players: [player(1, "Hero")],
        selfUsername: "Hero",
      });
      yield* world.addAura("player", 1, aura("Old Player Aura"));
      yield* world.addAura("monster", 2, aura("Old Monster Aura"));

      const result = yield* world.reduceCombatState({
        auraMutations: [
          {
            aura: aura("Too Late"),
            operation: "add",
            targetId: 2,
            targetType: "monster",
          },
        ],
        monsterPatches: [
          {
            monsterMapId: 2,
            patch: { hp: 0, state: EntityState.Dead },
          },
        ],
        playerPatches: [
          {
            patch: { hp: 0, state: EntityState.Dead },
            username: "Hero",
          },
        ],
      });

      expect(result.playerDeaths).toEqual([
        {
          cell: "Enter",
          entityId: 1,
          hp: 0,
          isSelf: true,
          pad: "Spawn",
          state: EntityState.Dead,
          username: "Hero",
        },
      ]);
      expect(result.monsterDeaths).toEqual([{ monsterMapId: 2 }]);
      expect(result.auraChanges).toEqual([]);
      expect(yield* world.getPlayerAuras(1)).toEqual([]);
      expect(yield* world.getMonsterAuras(2)).toEqual([]);
    }).pipe(Effect.provide(WorldStateLayer)),
  );
});
