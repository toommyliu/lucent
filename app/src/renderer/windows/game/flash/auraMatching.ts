import type { Aura } from "@lucent/game";

export interface AuraMatchOptions {
  readonly minStacks?: number;
  readonly minValue?: number;
}

const normalizeMinStacks = (
  options: AuraMatchOptions | undefined,
): number | undefined => {
  const minStacks = options?.minStacks;
  if (minStacks === undefined || !Number.isFinite(minStacks)) {
    return undefined;
  }

  return Math.max(1, Math.trunc(minStacks));
};

const normalizeMinValue = (
  options: AuraMatchOptions | undefined,
): number | undefined => {
  const minValue = options?.minValue;
  return minValue === undefined || !Number.isFinite(minValue)
    ? undefined
    : minValue;
};

export const matchesAura = (
  aura: Aura | null | undefined,
  options?: AuraMatchOptions,
): boolean => {
  if (aura === null || aura === undefined) {
    return false;
  }

  const minStacks = normalizeMinStacks(options);
  if (minStacks !== undefined && (aura.stack ?? 1) < minStacks) {
    return false;
  }

  const minValue = normalizeMinValue(options);
  if (
    minValue !== undefined &&
    (aura.value === undefined || aura.value < minValue)
  ) {
    return false;
  }

  return true;
};
