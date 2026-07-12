import { describe, expect, it } from "@effect/vitest";

import { normalizeArmyConfig, resolveArmyEquipSet } from "./army";

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
});
