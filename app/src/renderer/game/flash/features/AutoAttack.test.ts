import { describe, expect, it } from "@effect/vitest";

import { EntityState, LiveMonster, type MonsterData } from "@lucent/game";
import {
  parseAutoAttackTargetPriority,
  selectAutoAttackMonsterMapId,
} from "./AutoAttack";

const monster = (
  monsterMapId: number,
  name: string,
  patch: Partial<MonsterData> = {},
): LiveMonster =>
  new LiveMonster({
    cell: "Enter",
    hp: 100,
    level: 1,
    maxHp: 100,
    maxMp: 100,
    monsterId: monsterMapId,
    monsterMapId,
    mp: 100,
    name,
    race: "None",
    state: EntityState.Idle,
    ...patch,
  });

describe("AutoAttack target selection", () => {
  it("parses ordered priority targets from map ids and monster names", () => {
    expect(
      parseAutoAttackTargetPriority("id:7, Undead Warrior\nid-9; id11"),
    ).toEqual([
      { kind: "monster-map-id", monsterMapId: 7 },
      { kind: "monster-name", name: "Undead Warrior" },
      { kind: "monster-map-id", monsterMapId: 9 },
      { kind: "monster-map-id", monsterMapId: 11 },
    ]);
  });

  it("keeps unprefixed or unsupported id-looking tokens as monster names", () => {
    expect(parseAutoAttackTargetPriority("7, monMapId:9")).toEqual([
      { kind: "monster-name", name: "7" },
      { kind: "monster-name", name: "monMapId:9" },
    ]);
  });

  it("uses priority targets before the start snapshot", () => {
    expect(
      selectAutoAttackMonsterMapId({
        available: [
          monster(1, "Slime"),
          monster(2, "Dragon"),
          monster(3, "Slime"),
        ],
        snapshotTarget: { monsterMapId: 1 },
        targetPriority: [
          { kind: "monster-map-id", monsterMapId: 2 },
          { kind: "monster-name", name: "Slime" },
        ],
      }),
    ).toBe(2);
  });

  it("matches the first available monster name exactly", () => {
    expect(
      selectAutoAttackMonsterMapId({
        available: [
          monster(1, "Dark Dragon"),
          monster(2, "Dragon"),
          monster(3, "Dragon"),
        ],
        targetPriority: [{ kind: "monster-name", name: "dragon" }],
      }),
    ).toBe(2);
  });

  it("uses the start snapshot when no priority target is available", () => {
    expect(
      selectAutoAttackMonsterMapId({
        available: [monster(1, "Slime"), monster(2, "Dragon")],
        snapshotTarget: { monsterMapId: 2 },
        targetPriority: [{ kind: "monster-map-id", monsterMapId: 99 }],
      }),
    ).toBe(2);
  });

  it("falls back to the first available monster when needed", () => {
    expect(
      selectAutoAttackMonsterMapId({
        available: [
          monster(1, "Slime"),
          monster(2, "Dragon", { hp: 0, state: EntityState.Dead }),
        ],
        snapshotTarget: { monsterMapId: 2 },
      }),
    ).toBe(1);
  });
});
