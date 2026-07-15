import { describe, expect, it } from "vitest";

import { LiveItem } from "./item";
import {
  matchesAppliedEnhancement,
  matchesEnhancementShopItem,
  resolveEnhancementStrategy,
} from "./enhancement";

const item = (
  equipmentSlot: string,
  enhancement?: {
    readonly level?: number;
    readonly patternId?: number;
    readonly procId?: number;
  },
  category = equipmentSlot === "ar" ? "Class" : equipmentSlot,
) =>
  new LiveItem({
    category,
    coins: false,
    context: "inventory",
    cost: 0,
    description: "",
    ...(enhancement === undefined ? {} : { enhancement }),
    equipped: false,
    equipmentSlot,
    file: "",
    houseItem: false,
    itemId: 1,
    link: "",
    memberOnly: false,
    meta: "",
    name: "Item",
    quantity: 1,
    temporaryItem: false,
  });

describe("enhancement strategy", () => {
  it("resolves basic enhancement shops by item slot", () => {
    expect(resolveEnhancementStrategy(item("ar"), "lucky", 100)).toEqual({
      ok: true,
      strategy: {
        patternId: 9,
        procId: 0,
        shopId: 763,
        slot: "class",
      },
    });
  });

  it("resolves Forge weapon labels to their displayed pattern and proc", () => {
    const elysium = {
      ok: true,
      strategy: {
        map: "forge",
        patternId: 6,
        procId: 12,
        shopId: 2_142,
        slot: "weapon",
      },
    };
    expect(
      resolveEnhancementStrategy(item("Weapon"), "wizard", 100, "elysium"),
    ).toEqual(elysium);
    expect(
      resolveEnhancementStrategy(item("Weapon"), "forge", 100, "elysium"),
    ).toEqual(elysium);
    expect(resolveEnhancementStrategy(item("Weapon"), "elysium", 100)).toEqual(
      elysium,
    );

    const dauntless = {
      ok: true,
      strategy: {
        map: "forge",
        patternId: 2,
        procId: 14,
        shopId: 2_142,
        slot: "weapon",
      },
    };
    expect(
      resolveEnhancementStrategy(item("Weapon"), "fighter", 100, "dauntless"),
    ).toEqual(dauntless);
    expect(
      resolveEnhancementStrategy(item("Weapon"), "forge", 100, "dauntless"),
    ).toEqual(dauntless);

    const acheron = {
      ok: true,
      strategy: {
        map: "forge",
        patternId: 23,
        procId: 11,
        shopId: 2_142,
        slot: "weapon",
      },
    };
    expect(resolveEnhancementStrategy(item("Weapon"), "acheron", 100)).toEqual(
      acheron,
    );
    expect(
      resolveEnhancementStrategy(item("Weapon"), "forge", 100, "acheron"),
    ).toEqual(acheron);
    expect(
      resolveEnhancementStrategy(item("Weapon"), "depths", 100, "acheron"),
    ).toEqual(acheron);
    expect(
      resolveEnhancementStrategy(item("Weapon"), "lucky", 100, "dauntless"),
    ).toEqual({
      ok: false,
      reason: "The enhancement and special do not match their inventory label",
    });
  });

  it("accepts player-facing Forge helm and cape labels", () => {
    const vim = {
      ok: true,
      strategy: {
        map: "forge",
        patternId: 25,
        procId: 0,
        shopId: 2_164,
        slot: "helm",
      },
    };
    expect(resolveEnhancementStrategy(item("he"), "vim", 100)).toEqual(vim);
    expect(resolveEnhancementStrategy(item("he"), "forge", 100, "vim")).toEqual(
      vim,
    );

    const hearty = {
      ok: true,
      strategy: {
        map: "forge",
        patternId: 32,
        procId: 0,
        shopId: 2_164,
        slot: "helm",
      },
    };
    expect(resolveEnhancementStrategy(item("he"), "hearty", 100)).toEqual(
      hearty,
    );
    expect(
      resolveEnhancementStrategy(item("he"), "forge", 100, "hearty"),
    ).toEqual(hearty);
    expect(
      resolveEnhancementStrategy(item("he"), "grimskull", 100, "hearty"),
    ).toEqual(hearty);

    expect(resolveEnhancementStrategy(item("he"), "forge", 100)).toEqual({
      ok: true,
      strategy: {
        map: "forge",
        patternId: 10,
        procId: 0,
        shopId: 2_164,
        slot: "helm",
      },
    });

    expect(resolveEnhancementStrategy(item("ba"), "vainglory", 100)).toEqual({
      ok: true,
      strategy: {
        map: "forge",
        patternId: 24,
        procId: 0,
        shopId: 2_143,
        slot: "cape",
      },
    });
  });

  it("matches the exact inventory pattern and proc", () => {
    const resolution = resolveEnhancementStrategy(
      item("Weapon"),
      "fighter",
      100,
      "dauntless",
    );
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;

    const candidate = item(
      "Weapon",
      {
        level: 100,
        patternId: 2,
        procId: 14,
      },
      "Enhancement",
    );
    const wrongPattern = item(
      "Weapon",
      {
        level: 100,
        patternId: 9,
        procId: 14,
      },
      "Enhancement",
    );
    expect(matchesEnhancementShopItem(candidate, resolution.strategy)).toBe(
      true,
    );
    expect(matchesEnhancementShopItem(wrongPattern, resolution.strategy)).toBe(
      false,
    );
    expect(matchesAppliedEnhancement(candidate, resolution.strategy)).toBe(
      true,
    );
    expect(matchesAppliedEnhancement(wrongPattern, resolution.strategy)).toBe(
      false,
    );
  });
});
