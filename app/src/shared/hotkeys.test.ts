import { describe, expect, it } from "@effect/vitest";

import {
  hotkeyBindingMatchKey,
  hotkeyInputMatchKey,
  readHotkeyInputFromEvent,
} from "./hotkeys";

describe("hotkeys", () => {
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
