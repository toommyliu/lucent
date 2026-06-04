import { expect, test } from "vitest";
import { Avatar } from "./Avatar";
import { BaseEntity } from "./BaseEntity";
import { Monster } from "./Monster";
import { EntityState } from "../types/EntityState";

class TestEntity extends BaseEntity {
  public constructor(data: ConstructorParameters<typeof Monster>[0]) {
    super(data);
  }
}

test("isMonster checks monMapId instead of the model instance type", () => {
  const monster = new Monster({
    iLvl: 1,
    intHP: 100,
    intHPMax: 100,
    intMP: 100,
    intMPMax: 100,
    intState: EntityState.Idle,
    monId: 1,
    monMapId: 7,
    sRace: "None",
    strFrame: "Boss",
    strMonName: "Ultra Boss",
  });

  const avatar = new Avatar({
    afk: false,
    entID: 1,
    entType: "player",
    intHP: 100,
    intHPMax: 100,
    intLevel: 100,
    intMP: 100,
    intMPMax: 100,
    intState: EntityState.Idle,
    strFrame: "Enter",
    strPad: "Spawn",
    strUsername: "Hero",
    tx: 0,
    ty: 0,
    uoName: "hero",
  });

  const monsterLikeBase = new TestEntity(monster.data);

  expect(monster.isMonster()).toBe(true);
  expect(monsterLikeBase.isMonster()).toBe(true);
  expect(avatar.isMonster()).toBe(false);
});
