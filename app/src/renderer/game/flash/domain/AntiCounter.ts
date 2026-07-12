import type { Aura } from "@lucent/game";

const names = ["counter attack"];

export const isCounterAttackAura = (aura: Pick<Aura, "name">): boolean =>
  names.some((name) => aura.name.trim().toLowerCase().includes(name));
