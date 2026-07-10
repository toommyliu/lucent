import { describe, expect, it } from "vitest";

import {
  LiveAura,
  EntityState,
  LiveFaction,
  LiveItem,
  LiveMonster,
  LiveOutfit,
  LivePlayer,
  LiveQuest,
  LiveServer,
  LiveShop,
} from "./index";

describe("game domain models", () => {
  it("derives entity state and silently reflects updates", () => {
    const player = new LivePlayer({
      afk: false,
      cell: "Enter",
      entityId: 1,
      entityType: "player",
      hp: 50,
      level: 10,
      maxHp: 100,
      maxMp: 40,
      mp: 10,
      name: "Hero",
      pad: "Spawn",
      position: { x: 1, y: 2 },
      state: EntityState.InCombat,
      username: "Hero",
    });

    expect(player.alive).toBe(true);
    expect(player.hpPercent).toBe(50);
    expect(player.mpPercent).toBe(25);
    expect(player.inCombat).toBe(true);
    expect(player.isInCell(" enter ")).toBe(true);

    player.update({ hp: 0, state: EntityState.Dead });
    expect(player.dead).toBe(true);
    expect(player.toJSON()).toMatchObject({ alive: false, hp: 0 });
  });

  it("interprets item context, equipment type, and selectors", () => {
    const item = new LiveItem({
      category: "Weapon",
      charItemId: 10,
      coins: true,
      context: "inventory",
      cost: 100,
      description: "",
      equipped: true,
      equipmentSlot: "Weapon",
      file: "sword.swf",
      houseItem: false,
      itemId: 7,
      link: "Sword",
      meta: "",
      name: "Test Sword",
      quantity: 1,
      temporaryItem: false,
    });

    expect(item.weapon).toBe(true);
    expect(item.matches("test sword")).toBe(true);
    expect(item.matches("7")).toBe(false);
    expect(item.matches(7)).toBe(true);
    expect(item.matches({ name: "Test Sword" })).toBe(true);
    expect(item.matches({ itemId: 7 })).toBe(true);
    item.update({ context: "bank", equipped: false, shopItemId: 12 });
    expect(item.matches({ shopItemId: 12 })).toBe(true);
    expect(item.toJSON()).toMatchObject({ context: "bank", weapon: true });
  });

  it("models monster matching and the remaining catalog views", () => {
    const monster = new LiveMonster({
      cell: "r1",
      hp: 100,
      level: 5,
      maxHp: 100,
      maxMp: 0,
      monsterId: 8,
      monsterMapId: 9,
      mp: 0,
      name: "Undead Warrior",
      race: "Undead",
      state: EntityState.Idle,
    });
    const aura = new LiveAura({ duration: 5, name: "Focus", stack: 1 });
    const faction = new LiveFaction({
      id: 1,
      name: "Good",
      rank: 4,
      reputation: 500,
    });
    const outfit = new LiveOutfit({
      colors: {
        accessory: undefined,
        base: undefined,
        eye: undefined,
        hair: undefined,
        skin: undefined,
        trim: undefined,
      },
      equipment: {
        armorItemId: undefined,
        capeItemId: undefined,
        classItemId: undefined,
        helmItemId: undefined,
        itemId: undefined,
        miscItemId: undefined,
        petItemId: undefined,
        weaponItemId: undefined,
      },
      name: "Default",
    });
    const quest = new LiveQuest({
      cadence: "daily",
      id: 2,
      name: "Daily",
      once: false,
      requirements: [],
      rewards: [],
    });
    const server = new LiveServer({
      chat: 2,
      count: 100,
      language: "en",
      max: 100,
      memberOnly: false,
      name: "Artix",
      online: true,
    });
    const shop = new LiveShop({
      house: false,
      id: 3,
      items: [],
      limited: false,
      merge: true,
      name: "Merge",
    });

    expect(monster.matches("undead")).toBe(true);
    expect(monster.matches("id:9")).toBe(true);
    expect(server.full).toBe(true);
    expect(
      [aura, faction, outfit, quest, shop].map((model) => model.toJSON()),
    ).toHaveLength(5);
  });
});
