import type { Enhancement, Item } from "./item";

export type EnhancementSlot = "cape" | "class" | "helm" | "weapon";

export interface EnhancementStrategy {
  readonly map?: "forge" | "museum";
  readonly patternId: number;
  readonly procId: number;
  readonly shopId: number;
  readonly slot: EnhancementSlot;
}

export type EnhancementStrategyResolution =
  | { readonly ok: true; readonly strategy: EnhancementStrategy }
  | { readonly ok: false; readonly reason: string };

interface NamedValue {
  readonly aliases?: readonly string[];
  readonly displayName?: string;
  readonly name: string;
}

interface NamedPattern extends NamedValue {
  readonly patternId: number;
}

type WeaponSpecial =
  | (NamedValue & { readonly family: "awe"; readonly procId: number })
  | (NamedValue & {
      readonly family: "forge";
      readonly patternId: number;
      readonly procId: number;
    });

interface BasicEnhancement extends NamedPattern {
  readonly aweShopId?: number;
  readonly shopIds: {
    readonly high: number;
    readonly low: number;
  };
}

interface HelmEnhancement extends NamedPattern {
  readonly inventoryName?: string;
  readonly special: NamedValue;
}

const BASIC_HIGH_TIER_MINIMUM_PLAYER_LEVEL = 50;
const NO_PATTERN_ID = 0;
const NO_PROC_ID = 0;

const PATTERN_IDS = {
  absolution: 11,
  anima: 28,
  avarice: 12,
  depths: 23,
  examen: 26,
  fighter: 2,
  forge: 10,
  healer: 7,
  hearty: 32,
  hybrid: 5,
  lament: 30,
  lucky: 9,
  penitence: 29,
  pneuma: 27,
  spellbreaker: 8,
  thief: 3,
  vainglory: 24,
  vim: 25,
  wizard: 6,
} as const;

const WEAPON_PROC_IDS = {
  acheron: 11,
  arcanaConcerto: 10,
  aweBlast: 3,
  dauntless: 14,
  elysium: 12,
  healthVamp: 4,
  lacerate: 7,
  manaVamp: 5,
  powerwordDie: 6,
  praxis: 13,
  ravenous: 15,
  smite: 8,
  spiralCarve: 2,
  valiance: 9,
} as const;

const FORGE_SHOP_IDS = {
  cape: 2_143,
  helm: 2_164,
  weapon: 2_142,
} as const;

const BASIC_ENHANCEMENTS = [
  {
    aweShopId: 635,
    name: "fighter",
    patternId: PATTERN_IDS.fighter,
    shopIds: { high: 768, low: 141 },
  },
  {
    aweShopId: 637,
    name: "thief",
    patternId: PATTERN_IDS.thief,
    shopIds: { high: 767, low: 142 },
  },
  {
    aweShopId: 633,
    name: "hybrid",
    patternId: PATTERN_IDS.hybrid,
    shopIds: { high: 766, low: 143 },
  },
  {
    aweShopId: 636,
    name: "wizard",
    patternId: PATTERN_IDS.wizard,
    shopIds: { high: 765, low: 144 },
  },
  {
    aweShopId: 638,
    name: "healer",
    patternId: PATTERN_IDS.healer,
    shopIds: { high: 762, low: 145 },
  },
  {
    name: "spellbreaker",
    patternId: PATTERN_IDS.spellbreaker,
    shopIds: { high: 764, low: 146 },
  },
  {
    aweShopId: 639,
    name: "lucky",
    patternId: PATTERN_IDS.lucky,
    shopIds: { high: 763, low: 147 },
  },
] as const satisfies readonly BasicEnhancement[];

const WEAPON_SPECIALS = [
  {
    aliases: ["scarve", "spiral"],
    family: "awe",
    name: "spiral carve",
    procId: WEAPON_PROC_IDS.spiralCarve,
  },
  {
    aliases: ["ablast", "aweblast", "blast"],
    family: "awe",
    name: "awe blast",
    procId: WEAPON_PROC_IDS.aweBlast,
  },
  {
    aliases: ["healthvamp", "hvamp", "hp vamp"],
    family: "awe",
    name: "health vamp",
    procId: WEAPON_PROC_IDS.healthVamp,
  },
  {
    aliases: ["manavamp", "mvamp", "mp vamp"],
    family: "awe",
    name: "mana vamp",
    procId: WEAPON_PROC_IDS.manaVamp,
  },
  {
    aliases: ["powerword", "pwd", "pw die"],
    displayName: "Powerword DIE",
    family: "awe",
    name: "powerword die",
    procId: WEAPON_PROC_IDS.powerwordDie,
  },
  {
    aliases: ["lac"],
    family: "forge",
    name: "lacerate",
    patternId: PATTERN_IDS.forge,
    procId: WEAPON_PROC_IDS.lacerate,
  },
  {
    family: "forge",
    name: "smite",
    patternId: PATTERN_IDS.forge,
    procId: WEAPON_PROC_IDS.smite,
  },
  {
    aliases: ["val", "vali"],
    family: "forge",
    name: "valiance",
    patternId: PATTERN_IDS.forge,
    procId: WEAPON_PROC_IDS.valiance,
  },
  {
    aliases: ["arcanas", "arcana concerto", "concerto"],
    family: "forge",
    name: "arcana's concerto",
    patternId: PATTERN_IDS.forge,
    procId: WEAPON_PROC_IDS.arcanaConcerto,
  },
  {
    aliases: ["ach"],
    family: "forge",
    name: "acheron",
    patternId: PATTERN_IDS.depths,
    procId: WEAPON_PROC_IDS.acheron,
  },
  {
    aliases: ["ely"],
    family: "forge",
    name: "elysium",
    patternId: PATTERN_IDS.wizard,
    procId: WEAPON_PROC_IDS.elysium,
  },
  {
    aliases: ["prax"],
    family: "forge",
    name: "praxis",
    patternId: PATTERN_IDS.forge,
    procId: WEAPON_PROC_IDS.praxis,
  },
  {
    aliases: ["dtl"],
    family: "forge",
    name: "dauntless",
    patternId: PATTERN_IDS.fighter,
    procId: WEAPON_PROC_IDS.dauntless,
  },
  {
    aliases: ["rav"],
    family: "forge",
    name: "ravenous",
    patternId: PATTERN_IDS.forge,
    procId: WEAPON_PROC_IDS.ravenous,
  },
] as const satisfies readonly WeaponSpecial[];

const FORGE_WEAPON_PATTERNS = [
  { name: "forge", patternId: PATTERN_IDS.forge },
  { name: "depths", patternId: PATTERN_IDS.depths },
] as const satisfies readonly NamedPattern[];

const CAPE_SPECIALS = [
  { name: "forge", patternId: PATTERN_IDS.forge },
  {
    aliases: ["abso"],
    name: "absolution",
    patternId: PATTERN_IDS.absolution,
  },
  { aliases: ["ava"], name: "avarice", patternId: PATTERN_IDS.avarice },
  { name: "vainglory", patternId: PATTERN_IDS.vainglory },
  {
    aliases: ["peni"],
    name: "penitence",
    patternId: PATTERN_IDS.penitence,
  },
  { aliases: ["lam"], name: "lament", patternId: PATTERN_IDS.lament },
] as const satisfies readonly NamedPattern[];

const HELM_ENHANCEMENTS = [
  { name: "vim", patternId: PATTERN_IDS.vim, special: { name: "ether" } },
  {
    name: "examen",
    patternId: PATTERN_IDS.examen,
    special: { name: "ether" },
  },
  {
    name: "pneuma",
    patternId: PATTERN_IDS.pneuma,
    special: { name: "clairvoyance" },
  },
  {
    name: "anima",
    patternId: PATTERN_IDS.anima,
    special: { name: "clairvoyance" },
  },
  {
    inventoryName: "grimskull",
    name: "hearty",
    patternId: PATTERN_IDS.hearty,
    special: { name: "hearty" },
  },
] as const satisfies readonly HelmEnhancement[];

const EXTRA_PATTERN_DISPLAY_NAMES = new Map<number, string>([
  [1, "Adventurer"],
  [4, "Armsman"],
]);

const titleCase = (value: string): string =>
  value
    .split(" ")
    .map((word) =>
      word === "" ? word : `${word[0]!.toUpperCase()}${word.slice(1)}`,
    )
    .join(" ");

const namedValueDisplayName = (value: NamedValue): string =>
  value.displayName ?? titleCase(value.name);

const enhancementPatternDisplayNames = (
  patternId: number,
): readonly string[] | undefined => {
  const basic = BASIC_ENHANCEMENTS.find(
    (entry) => entry.patternId === patternId,
  );
  if (basic !== undefined) {
    return [namedValueDisplayName(basic)];
  }

  const weapon = FORGE_WEAPON_PATTERNS.find(
    (entry) => entry.patternId === patternId,
  );
  if (weapon !== undefined) {
    return [namedValueDisplayName(weapon)];
  }

  const cape = CAPE_SPECIALS.find((entry) => entry.patternId === patternId);
  if (cape !== undefined) {
    const name = namedValueDisplayName(cape);
    return name === "Forge" ? [name] : ["Forge", name];
  }

  const helm = HELM_ENHANCEMENTS.find((entry) => entry.patternId === patternId);
  if (helm !== undefined) {
    return [
      titleCase("inventoryName" in helm ? helm.inventoryName : helm.name),
      namedValueDisplayName(helm.special),
    ];
  }

  const extra = EXTRA_PATTERN_DISPLAY_NAMES.get(patternId);
  return extra === undefined ? undefined : [extra];
};

export const formatItemEnhancement = (
  enhancement: Pick<Enhancement, "level" | "patternId" | "procId"> | undefined,
): string | undefined => {
  if (enhancement === undefined) {
    return undefined;
  }

  const parts: string[] = [];
  const patternId = enhancement.patternId;
  if (patternId !== undefined && patternId > 0) {
    parts.push(
      ...(enhancementPatternDisplayNames(patternId) ?? [
        `Pattern ${patternId}`,
      ]),
    );
  }

  const procId = enhancement.procId;
  if (procId !== undefined && procId > 0) {
    const proc = WEAPON_SPECIALS.find((entry) => entry.procId === procId);
    parts.push(
      proc === undefined ? `Proc ${procId}` : namedValueDisplayName(proc),
    );
  }

  const level = enhancement.level;
  if (level !== undefined && level > 0) {
    parts.push(`Level ${level}`);
  }

  return parts.length === 0 ? undefined : parts.join(", ");
};

const normalize = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replaceAll(/[‘’]/gu, "'")
    .replaceAll(/\s+/gu, " ");

const matchesNamedValue = (entry: NamedValue, value: string): boolean => {
  const requested = normalize(value);
  return (
    entry.name === requested ||
    entry.aliases?.some((alias) => alias === requested) === true
  );
};

const resolveNamedValue = <Entry extends NamedValue>(
  entries: readonly Entry[],
  value: string,
): Entry | undefined =>
  entries.find((entry) => matchesNamedValue(entry, value));

const resolvePatternId = (
  entries: readonly NamedPattern[],
  value: string,
): number | undefined => resolveNamedValue(entries, value)?.patternId;

const inventoryHelmName = (entry: HelmEnhancement): string =>
  entry.inventoryName ?? entry.name;

const resolveInventoryHelmEnhancement = (
  enhancement: string,
  special: string,
): HelmEnhancement | undefined =>
  HELM_ENHANCEMENTS.find(
    (entry) =>
      normalize(inventoryHelmName(entry)) === normalize(enhancement) &&
      matchesNamedValue(entry.special, special),
  );

const enhancementSlot = (
  item: Pick<Item, "cape" | "classItem" | "helm" | "weapon">,
): EnhancementSlot | undefined => {
  if (item.weapon) return "weapon";
  if (item.cape) return "cape";
  if (item.helm) return "helm";
  if (item.classItem) return "class";
  return undefined;
};

const basicStrategy = (
  enhancement: BasicEnhancement,
  playerLevel: number,
  slot: EnhancementSlot,
): EnhancementStrategyResolution => ({
  ok: true,
  strategy: {
    patternId: enhancement.patternId,
    procId: NO_PROC_ID,
    shopId:
      enhancement.shopIds[
        playerLevel >= BASIC_HIGH_TIER_MINIMUM_PLAYER_LEVEL ? "high" : "low"
      ],
    slot,
  },
});

export const resolveEnhancementStrategy = (
  item: Pick<Item, "cape" | "classItem" | "helm" | "weapon">,
  enhancement: string,
  playerLevel: number,
  special?: string,
): EnhancementStrategyResolution => {
  const slot = enhancementSlot(item);
  if (slot === undefined) {
    return { ok: false, reason: "The selected item cannot be enhanced" };
  }

  const requested = normalize(enhancement);
  const requestedSpecial = normalize(special ?? "");
  const basicEnhancement = resolveNamedValue<BasicEnhancement>(
    BASIC_ENHANCEMENTS,
    requested,
  );
  const forge = requested === "forge";

  if (slot === "class") {
    if (forge || requestedSpecial !== "" || basicEnhancement === undefined) {
      return {
        ok: false,
        reason: "The requested enhancement cannot be applied to a class",
      };
    }
    return basicStrategy(basicEnhancement, playerLevel, slot);
  }

  if (slot === "weapon") {
    const explicitSpecial =
      requestedSpecial === ""
        ? undefined
        : resolveNamedValue(WEAPON_SPECIALS, requestedSpecial);
    if (requestedSpecial !== "" && explicitSpecial === undefined) {
      return { ok: false, reason: "Unknown weapon enhancement special" };
    }

    const shorthandSpecial =
      requestedSpecial === ""
        ? resolveNamedValue(WEAPON_SPECIALS, requested)
        : undefined;
    const weaponSpecial =
      explicitSpecial ??
      (shorthandSpecial?.family === "forge" ? shorthandSpecial : undefined);
    const requestedPatternId =
      basicEnhancement?.patternId ??
      resolvePatternId(FORGE_WEAPON_PATTERNS, requested);

    if (weaponSpecial === undefined) {
      if (basicEnhancement !== undefined) {
        return basicStrategy(basicEnhancement, playerLevel, slot);
      }
      if (requestedPatternId !== PATTERN_IDS.forge) {
        return { ok: false, reason: "Unknown weapon enhancement" };
      }
      return {
        ok: true,
        strategy: {
          map: "forge",
          patternId: PATTERN_IDS.forge,
          procId: NO_PROC_ID,
          shopId: FORGE_SHOP_IDS.weapon,
          slot,
        },
      };
    }

    if (weaponSpecial.family === "awe") {
      if (basicEnhancement === undefined) {
        return {
          ok: false,
          reason: "Awe specials require a basic enhancement",
        };
      }
      const shopId = basicEnhancement.aweShopId;
      return shopId === undefined
        ? { ok: false, reason: "No Awe enhancement shop matched the request" }
        : {
            ok: true,
            strategy: {
              map: "museum",
              patternId: basicEnhancement.patternId,
              procId: weaponSpecial.procId,
              shopId,
              slot,
            },
          };
    }

    const usesForgeFamily = forge && explicitSpecial !== undefined;
    const usesStandaloneLabel = shorthandSpecial === weaponSpecial;
    if (
      !usesForgeFamily &&
      !usesStandaloneLabel &&
      requestedPatternId !== weaponSpecial.patternId
    ) {
      return {
        ok: false,
        reason:
          "The enhancement and special do not match their inventory label",
      };
    }
    return {
      ok: true,
      strategy: {
        map: "forge",
        patternId: weaponSpecial.patternId,
        procId: weaponSpecial.procId,
        shopId: FORGE_SHOP_IDS.weapon,
        slot,
      },
    };
  }

  if (slot === "helm") {
    if (basicEnhancement !== undefined && requestedSpecial === "") {
      return basicStrategy(basicEnhancement, playerLevel, slot);
    }
    if (forge && requestedSpecial === "") {
      return {
        ok: true,
        strategy: {
          map: "forge",
          patternId: PATTERN_IDS.forge,
          procId: NO_PROC_ID,
          shopId: FORGE_SHOP_IDS.helm,
          slot,
        },
      };
    }

    const helmEnhancement = forge
      ? resolveNamedValue<HelmEnhancement>(HELM_ENHANCEMENTS, requestedSpecial)
      : requestedSpecial === ""
        ? resolveNamedValue<HelmEnhancement>(HELM_ENHANCEMENTS, requested)
        : resolveInventoryHelmEnhancement(requested, requestedSpecial);
    if (helmEnhancement === undefined) {
      return {
        ok: false,
        reason: "Unknown Forge helm enhancement",
      };
    }
    return {
      ok: true,
      strategy: {
        map: "forge",
        patternId: helmEnhancement.patternId,
        procId: NO_PROC_ID,
        shopId: FORGE_SHOP_IDS.helm,
        slot,
      },
    };
  }

  if (basicEnhancement !== undefined && requestedSpecial === "") {
    return basicStrategy(basicEnhancement, playerLevel, slot);
  }
  const shorthandCape =
    requestedSpecial === ""
      ? resolveNamedValue(CAPE_SPECIALS, requested)
      : undefined;
  const patternId = forge
    ? requestedSpecial === ""
      ? PATTERN_IDS.forge
      : resolvePatternId(CAPE_SPECIALS, requestedSpecial)
    : shorthandCape?.patternId;
  if (patternId === undefined) {
    return { ok: false, reason: "Unknown Forge cape enhancement" };
  }
  return {
    ok: true,
    strategy: {
      map: "forge",
      patternId,
      procId: NO_PROC_ID,
      shopId: FORGE_SHOP_IDS.cape,
      slot,
    },
  };
};

const normalizedEquipmentSlot = (item: Pick<Item, "equipmentSlot">) =>
  normalize(item.equipmentSlot);

const matchesSlot = (
  item: Pick<Item, "equipmentSlot">,
  slot: EnhancementSlot,
): boolean => {
  const actual = normalizedEquipmentSlot(item);
  switch (slot) {
    case "weapon":
      return actual === "weapon";
    case "cape":
      return actual === "ba" || actual === "cape";
    case "helm":
      return actual === "he" || actual === "helm";
    case "class":
      return actual === "ar" || actual === "class";
  }
};

export const matchesEnhancementShopItem = (
  item: Pick<Item, "category" | "enhancement" | "equipmentSlot">,
  strategy: EnhancementStrategy,
): boolean => {
  if (normalize(item.category) !== "enhancement") return false;
  if (!matchesSlot(item, strategy.slot)) return false;
  const patternId = item.enhancement?.patternId ?? NO_PATTERN_ID;
  const procId = item.enhancement?.procId ?? NO_PROC_ID;
  return patternId === strategy.patternId && procId === strategy.procId;
};

export const matchesAppliedEnhancement = (
  item: Pick<Item, "enhancement">,
  strategy: Pick<EnhancementStrategy, "patternId" | "procId">,
): boolean => {
  const patternId = item.enhancement?.patternId ?? NO_PATTERN_ID;
  const procId = item.enhancement?.procId ?? NO_PROC_ID;
  return patternId === strategy.patternId && procId === strategy.procId;
};
