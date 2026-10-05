import { describe, expect, it } from "@effect/vitest";
import { DEFAULT_HOTKEYS } from "@lucent/core/hotkeys";

import {
  findConflictingCommands,
  groupCommandsByShortcut,
} from "./hotkeyConflicts";

const labels = (
  platform: "linux" | "mac" | "windows",
  value: string,
): readonly string[] =>
  findConflictingCommands(
    groupCommandsByShortcut(DEFAULT_HOTKEYS.bindings, platform),
    "toggleBank",
    value,
    platform,
  ).map((command) => command.label);

describe("findConflictingCommands", () => {
  it("matches a recorded Meta shortcut against a Mod default on macOS", () => {
    expect(labels("mac", "Shift+Meta+T")).toEqual(["Toggle Top Bar"]);
  });

  it("matches a recorded Control shortcut against a Mod default on Windows", () => {
    expect(labels("windows", "Control+Shift+T")).toEqual(["Toggle Top Bar"]);
    expect(labels("windows", "Shift+Meta+T")).toEqual([]);
  });

  it("ignores the command being edited and unbound values", () => {
    expect(labels("mac", "Mod+B")).toEqual([]);
    expect(labels("mac", "")).toEqual([]);
  });
});
