import type { AuraRecord } from "./Types";

const normalizeText = (value: string): string =>
  value.trim().toLowerCase().replace(/\s+/g, " ");

const antiCounterAuraNames = ["Counter Attack"] as const;
const antiCounterAuraPatterns = [/\bcounter\b.*\battack\b/i] as const;
const fallbackDurationMs = 7_000;
const graceDurationMs = 750;

export const isAntiCounterAuraName = (name: string): boolean => {
  const normalized = normalizeText(name);
  return (
    antiCounterAuraNames.some(
      (auraName) => normalizeText(auraName) === normalized,
    ) || antiCounterAuraPatterns.some((pattern) => pattern.test(normalized))
  );
};

export const isAntiCounterAura = (aura: AuraRecord): boolean =>
  isAntiCounterAuraName(aura.name);

export const antiCounterExpiresAtMs = (
  aura: Pick<AuraRecord, "duration">,
  nowMs = Date.now(),
): number => {
  const durationMs =
    Number.isFinite(aura.duration) && aura.duration > 0
      ? aura.duration * 1_000
      : fallbackDurationMs;
  return nowMs + durationMs + graceDurationMs;
};
