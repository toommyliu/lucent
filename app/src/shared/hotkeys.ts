import {
  hotkeyBindingMatchKey,
  type HotkeyDisplayPlatform,
} from "@lucent/core/hotkeys";

export * from "@lucent/core/hotkeys";

const punctuationCodeMap: Readonly<Record<string, string>> = {
  Backquote: "`",
  Backslash: "\\",
  BracketLeft: "[",
  BracketRight: "]",
  Comma: ",",
  Equal: "=",
  Minus: "-",
  Period: ".",
  Semicolon: ";",
  Slash: "/",
};

type HotkeyKeyboardEvent = Pick<
  KeyboardEvent,
  "altKey" | "code" | "ctrlKey" | "key" | "metaKey" | "shiftKey"
>;

const readPhysicalKeyFromCode = (code: string): string | null => {
  if (code.startsWith("Key")) {
    const value = code.slice(3);
    return /^[A-Z]$/.test(value) ? value : null;
  }

  if (code.startsWith("Digit")) {
    const value = code.slice(5);
    return /^[0-9]$/.test(value) ? value : null;
  }

  return punctuationCodeMap[code] ?? null;
};

export const readHotkeyInputFromEvent = (
  event: HotkeyKeyboardEvent,
): string => {
  const parts: string[] = [];
  if (event.ctrlKey) {
    parts.push("Control");
  }
  if (event.altKey) {
    parts.push("Alt");
  }
  if (event.shiftKey) {
    parts.push("Shift");
  }
  if (event.metaKey) {
    parts.push("Meta");
  }

  const hasModifier =
    event.ctrlKey || event.altKey || event.shiftKey || event.metaKey;
  const physicalKey =
    hasModifier && event.code.length > 0
      ? readPhysicalKeyFromCode(event.code)
      : null;
  parts.push(physicalKey ?? event.key);
  return parts.join("+");
};

export const hotkeyInputMatchKey = (
  event: HotkeyKeyboardEvent,
  platform: HotkeyDisplayPlatform,
): string | null =>
  hotkeyBindingMatchKey(readHotkeyInputFromEvent(event), platform);
