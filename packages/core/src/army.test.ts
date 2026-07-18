import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";

import {
  ArmyLoopTauntCommandPayloadSchema,
  ArmyLoopTauntRegisterPayloadSchema,
  ArmyLoopTauntReportPayloadSchema,
  normalizeArmyConfig,
  resolveArmyEquipSet,
} from "./army";

describe("army config", () => {
  it("normalizes modern YAML config and slot-based sets", () => {
    const config = normalizeArmyConfig("ultra", {
      custom: { value: true },
      items: {
        supportPotion: "Felicitous Philtre",
      },
      players: ["Alice", "Bob"],
      room: "1234",
      sets: {
        boss: {
          default: {
            cape: "Shared Cape",
            class: "Legion Revenant",
            pots: ["supportPotion"],
          },
          player2: {
            class: "Lord of Order",
          },
        },
      },
    });

    expect(config.players).toEqual(["Alice", "Bob"]);
    expect(config.room).toBe("1234");
    expect(config.items["supportPotion"]).toBe("Felicitous Philtre");
    expect(config.raw["custom"]).toEqual({ value: true });
    expect(
      resolveArmyEquipSet({ playerNumber: 2, sets: config.sets }, "boss"),
    ).toEqual({
      cape: "Shared Cape",
      class: "Lord of Order",
      pots: ["supportPotion"],
    });
  });

  it("does not accept legacy player-count configs", () => {
    expect(() =>
      normalizeArmyConfig("legacy", {
        Player1: "Alice",
        PlayerCount: 1,
        RoomNumber: "1234",
      }),
    ).toThrow("Army config players must be a non-empty array");
  });

  it("rejects set slots outside the configured roster", () => {
    expect(() =>
      normalizeArmyConfig("bad-set", {
        players: ["Alice"],
        room: "1234",
        sets: {
          boss: {
            player2: {
              class: "Lord of Order",
            },
          },
        },
      }),
    ).toThrow("Army set slot player2 is outside the configured player roster");
  });

  it("rejects roster duplicates without case sensitivity", () => {
    expect(() =>
      normalizeArmyConfig("duplicates", {
        players: ["Alice", " alice "],
        room: "1234",
      }),
    ).toThrow("Duplicate army player: alice");
  });

  it("retains custom raw values for script config access", () => {
    const config = normalizeArmyConfig("custom.yaml", {
      mechanics: { tauntAt: 40 },
      players: ["Alice"],
      room: 1234,
    });

    expect(config.configName).toBe("custom");
    expect(config.room).toBe("1234");
    expect(config.raw["mechanics"]).toEqual({ tauntAt: 40 });
  });

  it("rejects unknown equipment keys and malformed potion lists", () => {
    expect(() =>
      normalizeArmyConfig("unknown-field", {
        players: ["Alice"],
        room: "1234",
        sets: { boss: { default: { ring: "Unknown" } } },
      }),
    ).toThrow("Unknown army equip set key: sets.boss.default.ring");

    expect(() =>
      normalizeArmyConfig("bad-pots", {
        players: ["Alice"],
        room: "1234",
        sets: { boss: { default: { pots: "Potion" } } },
      }),
    ).toThrow("sets.boss.default.pots must be an array");
  });

  it("decodes Loop Taunt assignments with their resolved targets and map", () => {
    const payload = Schema.decodeUnknownSync(
      ArmyLoopTauntRegisterPayloadSchema,
    )({
      assignments: [
        {
          assignmentId: 0,
          players: [1, 2],
          strategy: { type: "focus" },
          target: {
            focusActive: false,
            lifeRevision: 3,
            monsterMapId: 1,
            state: "alive",
          },
        },
        {
          assignmentId: 1,
          players: [3],
          strategy: {
            message: "The boss prepares an attack",
            type: "message",
          },
          target: {
            focusActive: true,
            lifeRevision: 3,
            monsterMapId: 2,
            state: "alive",
          },
        },
      ],
      map: { id: 12, name: "ultra", roomNumber: 4_321 },
      sessionId: "session-1",
    });

    expect(payload.assignments).toHaveLength(2);
    expect(payload.assignments[1]?.strategy).toEqual({
      message: "The boss prepares an attack",
      type: "message",
    });
    expect(payload.assignments[1]?.target.monsterMapId).toBe(2);
    expect(payload.map).toEqual({
      id: 12,
      name: "ultra",
      roomNumber: 4_321,
    });
  });

  it("decodes assignment-bound reports and taunt commands", () => {
    expect(
      Schema.decodeUnknownSync(ArmyLoopTauntReportPayloadSchema)({
        report: {
          assignmentId: 1,
          lifeRevision: 3,
          message: "The boss prepares an attack",
          monsterMapId: 2,
          source: "animation",
          type: "message",
        },
        runId: "run-1",
        sessionId: "session-1",
      }).report,
    ).toMatchObject({ assignmentId: 1, type: "message" });

    expect(
      Schema.decodeUnknownSync(ArmyLoopTauntCommandPayloadSchema)({
        command: {
          assignmentId: 0,
          lifeRevision: 3,
          monsterMapId: 1,
          type: "taunt",
        },
        commandId: 9,
        runId: "run-1",
        sessionId: "session-1",
      }).command,
    ).toMatchObject({ assignmentId: 0, lifeRevision: 3, type: "taunt" });
  });

  it("rejects negative Loop Taunt assignment IDs and life revisions", () => {
    expect(() =>
      Schema.decodeUnknownSync(ArmyLoopTauntRegisterPayloadSchema)({
        assignments: [
          {
            assignmentId: -1,
            players: [1],
            strategy: { type: "focus" },
            target: {
              focusActive: false,
              lifeRevision: 0,
              monsterMapId: 2,
              state: "alive",
            },
          },
        ],
        map: { id: 12, name: "ultra", roomNumber: 4_321 },
        sessionId: "session-1",
      }),
    ).toThrow();

    expect(() =>
      Schema.decodeUnknownSync(ArmyLoopTauntReportPayloadSchema)({
        report: {
          assignmentId: 0,
          lifeRevision: -1,
          message: "The boss prepares an attack",
          monsterMapId: 2,
          source: "animation",
          type: "message",
        },
        runId: "run-1",
        sessionId: "session-1",
      }),
    ).toThrow();
  });

  it("rejects invalid Loop Taunt cooldowns", () => {
    for (const cooldownMs of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        Schema.decodeUnknownSync(ArmyLoopTauntReportPayloadSchema)({
          report: {
            alive: true,
            cooldownMs,
            type: "participant-state",
            usable: true,
          },
          runId: "run-1",
          sessionId: "session-1",
        }),
      ).toThrow();
    }
  });

  it("rejects removed completion reports and attack commands", () => {
    expect(() =>
      Schema.decodeUnknownSync(ArmyLoopTauntReportPayloadSchema)({
        report: {
          complete: true,
          type: "completion",
        },
        runId: "run-1",
        sessionId: "session-1",
      }),
    ).toThrow();

    expect(() =>
      Schema.decodeUnknownSync(ArmyLoopTauntCommandPayloadSchema)({
        command: {
          assignmentId: 0,
          monsterMapId: 1,
          type: "attack",
        },
        commandId: 9,
        runId: "run-1",
        sessionId: "session-1",
      }),
    ).toThrow();
  });
});
