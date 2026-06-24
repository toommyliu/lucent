import { describe, expect, it } from "@effect/vitest";

import { formatHotkeyDisplay, formatHotkeyDisplayParts } from "./hotkeys";

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
});
