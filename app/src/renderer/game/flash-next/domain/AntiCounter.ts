import type { Aura } from "@lucent/game";

const names = ["counter attack", "counter", "reflect"];

export const isAntiCounterAura = (aura: Pick<Aura, "name">): boolean =>
  names.some((name) => aura.name.trim().toLowerCase().includes(name));

export const antiCounterExpiresAt = (aura: Pick<Aura, "duration">): number =>
  Date.now() + Math.max(0, aura.duration) * 1_000;
