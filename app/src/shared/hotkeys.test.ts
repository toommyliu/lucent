import { describe, expect, it } from "@effect/vitest";

import {
  formatHotkeyDisplay,
  formatHotkeyDisplayParts,
  hotkeyBindingMatchKey,
  hotkeyInputMatchKey,
  readHotkeyInputFromEvent,
} from "./hotkeys";

describe("hotkeys", () => {
  it("formats normalized hotkeys for platform display", () => {
    expect(formatHotkeyDisplay("", "mac")).toBe("Unbound");
    expect(formatHotkeyDisplay("Mod+Shift+X", "mac")).toBe("⌘ ⇧ X");
    expect(formatHotkeyDisplayParts("Mod+Shift+X", "mac")).toEqual([
      "⌘",
      "⇧",
      "X",
    ]);
    expect(formatHotkeyDisplay("Mod+Shift+X", "windows")).toBe("Ctrl+Shift+X");
  });

  it("resolves Mod to the platform modifier for matching", () => {
    expect(hotkeyBindingMatchKey("Mod+O", "windows")).toBe(
      hotkeyBindingMatchKey("Control+O", "windows"),
    );
    expect(hotkeyBindingMatchKey("Mod+O", "linux")).toBe(
      hotkeyBindingMatchKey("Control+O", "linux"),
    );
    expect(hotkeyBindingMatchKey("Mod+O", "mac")).toBe(
      hotkeyBindingMatchKey("Meta+O", "mac"),
    );
    expect(hotkeyBindingMatchKey("Mod+Shift+T", "mac")).toBe(
      hotkeyBindingMatchKey("Shift+Meta+T", "mac"),
    );
  });

  it("reads modified punctuation from the physical key code", () => {
    const input = {
      altKey: false,
      code: "Comma",
      ctrlKey: true,
      key: "<",
      metaKey: false,
      shiftKey: true,
    };

    expect(readHotkeyInputFromEvent(input)).toBe("Control+Shift+,");
    expect(hotkeyInputMatchKey(input, "windows")).toBe(
      hotkeyBindingMatchKey("Mod+Shift+,", "windows"),
    );
  });
});
