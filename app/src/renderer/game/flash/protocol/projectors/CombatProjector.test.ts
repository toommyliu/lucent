import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { EntityState, LiveAura, LiveMonster, LivePlayer } from "@lucent/game";
import type { FlashPacket } from "../../Types";
import { WorldState, layer as WorldStateLayer } from "../../state/World";
import { projectCombatPacket } from "./CombatProjector";
import { makeTargetRelations } from "./TargetRelations";

const packet = (
  command: "cb" | "ct",
  data: Record<string, unknown>,
): FlashPacket => ({
  command,
  data,
  direction: command === "ct" ? "server" : "extension",
  raw: "",
  wireType: "json",
});

const player = () =>
  new LivePlayer({
    afk: false,
    cell: "Enter",
    entityId: 1,
    entityType: "player",
    hp: 100,
    level: 1,
    maxHp: 100,
    maxMp: 50,
    mp: 50,
    name: "Hero",
    pad: "Spawn",
    position: { x: 0, y: 0 },
    state: EntityState.Idle,
    username: "Hero",
  });

const monster = () =>
  new LiveMonster({
    cell: "Enter",
    hp: 100,
    level: 1,
    maxHp: 100,
    maxMp: 30,
    monsterId: 7,
    monsterMapId: 7,
    mp: 30,
    name: "Training Dummy",
    race: "None",
    state: EntityState.Idle,
  });

const seedWorld = (world: typeof WorldState.Service) =>
  world.replaceArea({
    map: { id: 1, name: "battleon", roomNumber: 1001 },
    monsters: [monster()],
    players: [player()],
    selfUsername: "Hero",
  });

describe("Combat projector", () => {
  it.effect("applies combat patches atomically and emits deaths once", () =>
    Effect.gen(function* () {
      const world = yield* WorldState;
      const relations = makeTargetRelations();
      yield* seedWorld(world);
      yield* world.addAura(
        "player",
        1,
        new LiveAura({ duration: 5, kind: "active", name: "Focus", stack: 1 }),
      );
      yield* world.addAura(
        "monster",
        7,
        new LiveAura({ duration: 5, kind: "active", name: "Guard", stack: 1 }),
      );

      const events = yield* projectCombatPacket(
        packet("ct", {
          m: { 7: { intHP: 0, intState: EntityState.Dead } },
          p: { Hero: { intHP: -5, intState: EntityState.Dead } },
        }),
        world,
        relations,
      );
      expect(events.map((event) => event.type).toSorted()).toEqual([
        "monsterDeath",
        "playerDeath",
      ]);
      expect(yield* world.getPlayerAuras(1)).toEqual([]);
      expect(yield* world.getMonsterAuras(7)).toEqual([]);

      const repeated = yield* projectCombatPacket(
        packet("ct", {
          m: { 7: { intHP: 0, intState: EntityState.Dead } },
          p: { Hero: { intHP: 0, intState: EntityState.Dead } },
        }),
        world,
        relations,
      );
      expect(repeated).toEqual([]);
    }).pipe(Effect.provide(WorldStateLayer)),
  );

  it.effect("tracks aura kinds, stacks, refreshes, and local messages", () =>
    Effect.gen(function* () {
      const world = yield* WorldState;
      const relations = makeTargetRelations();
      yield* seedWorld(world);

      const first = yield* projectCombatPacket(
        packet("cb", {
          a: [
            {
              auras: [
                {
                  dur: 5,
                  isNew: true,
                  msgOn: "@Self only",
                  nam: "Focus",
                },
              ],
              cmd: "aura+",
              tInf: "p:1",
            },
          ],
        }),
        world,
        relations,
      );
      const firstAura = first.find((event) => event.type === "auraAdded");
      expect(
        firstAura?.type === "auraAdded" ? firstAura.payload.auraKind : null,
      ).toBe("active");
      expect(
        first.find((event) => event.type === "updateMessage")?.type ===
          "updateMessage"
          ? first.find((event) => event.type === "updateMessage")?.payload
              .message
          : null,
      ).toBe("Self only");

      const refreshed = yield* projectCombatPacket(
        packet("cb", {
          a: [
            {
              auras: [{ dur: 9, isNew: false, nam: "Focus" }],
              cmd: "aura+",
              tInf: "p:1",
            },
          ],
        }),
        world,
        relations,
      );
      expect(
        firstAura?.type === "auraAdded" ? firstAura.payload.aura.duration : 0,
      ).toBe(5);
      expect(
        refreshed[0]?.type === "auraAdded"
          ? refreshed[0].payload.aura.duration
          : 0,
      ).toBe(9);

      const passive = yield* projectCombatPacket(
        packet("cb", {
          a: [
            {
              auras: [{ dur: 30, msgOn: "Hidden", nam: "Focus" }],
              cmd: "aura+p",
              tInf: "p:1",
            },
          ],
        }),
        world,
        relations,
      );
      expect(passive.map((event) => event.type)).toEqual(["auraAdded"]);
      expect(
        passive[0]?.type === "auraAdded" ? passive[0].payload.auraKind : null,
      ).toBe("passive");
      expect((yield* world.getPlayerAuras(1))[0]?.stack).toBe(1);
      expect(
        (yield* world.getPlayerAuras(1, { kind: "passive" }))[0]?.stack,
      ).toBe(1);
    }).pipe(Effect.provide(WorldStateLayer)),
  );

  it.effect("keeps animation target metadata when the source is a player", () =>
    Effect.gen(function* () {
      const world = yield* WorldState;
      yield* seedWorld(world);

      const events = yield* projectCombatPacket(
        packet("ct", {
          anims: [
            {
              cInf: "p:1",
              msg: "Hero attacks <mon>",
              tInf: "m:7",
            },
          ],
        }),
        world,
        makeTargetRelations(),
      );
      const message = events[0];
      expect(message?.type).toBe("updateMessage");
      if (message?.type === "updateMessage") {
        expect(message.payload.message).toBe("Hero attacks <mon>");
        expect(message.payload.monMapId).toBe(7);
        expect(message.payload.sourceMonMapId).toBeUndefined();
        expect(message.payload.targetMonMapId).toBe(7);
      }
    }).pipe(Effect.provide(WorldStateLayer)),
  );
});
