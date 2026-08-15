export interface GameViewShortcutInput {
  readonly alt: boolean;
  readonly code: string;
  readonly control: boolean;
  readonly isComposing: boolean;
  readonly key: string;
  readonly meta: boolean;
  readonly shift: boolean;
  readonly type: string;
}

const primaryModifier = (
  input: GameViewShortcutInput,
  platform: NodeJS.Platform,
): boolean => (platform === "darwin" ? input.meta : input.control);

const secondaryModifier = (
  input: GameViewShortcutInput,
  platform: NodeJS.Platform,
): boolean => (platform === "darwin" ? input.control : input.meta);

const isPrimaryModifierKey = (
  input: GameViewShortcutInput,
  platform: NodeJS.Platform,
): boolean => {
  const key = platform === "darwin" ? "Meta" : "Control";
  return input.key === key || input.code.startsWith(key);
};

/** Reports the primary modifier state, including its initial keydown event. */
export const isGameViewPrimaryModifierPressed = (
  input: GameViewShortcutInput,
  platform: NodeJS.Platform,
): boolean =>
  isPrimaryModifierKey(input, platform)
    ? input.type !== "keyUp"
    : primaryModifier(input, platform);

/** Arms hints on primary-modifier down and dismisses them on any other keydown. */
export const readGameViewShortcutModifierHintUpdate = (
  input: GameViewShortcutInput,
  platform: NodeJS.Platform,
): boolean | null => {
  if (isPrimaryModifierKey(input, platform)) {
    return isGameViewPrimaryModifierPressed(input, platform);
  }
  if (input.type === "keyDown") {
    return false;
  }

  // Do not re-arm a dismissed hint from the modifier flag on another key's keyup.
  return isGameViewPrimaryModifierPressed(input, platform) ? null : false;
};

/** Resolves a primary-modifier number shortcut to its zero-based tab index. */
export const readGameViewShortcutIndex = (
  input: GameViewShortcutInput,
  platform: NodeJS.Platform,
  viewCount: number,
): number | null => {
  if (
    input.type !== "keyDown" ||
    input.isComposing ||
    !primaryModifier(input, platform) ||
    secondaryModifier(input, platform) ||
    input.alt ||
    input.shift
  ) {
    return null;
  }

  const match = /^(?:Digit|Numpad)([1-9])$/.exec(input.code);
  if (match === null) {
    return null;
  }

  const index = Number(match[1]) - 1;
  return index < viewCount ? index : null;
};
