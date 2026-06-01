import { describe, expect, it } from "vitest";
import {
  DEFAULT_APPEARANCE,
  DEFAULT_HOTKEYS,
  DEFAULT_PREFERENCES,
  type AppSettings,
} from "./settings";
import {
  readSettingsSnapshotArgument,
  serializeSettingsSnapshotArgument,
} from "./settings-snapshot";

const settings: AppSettings = {
  preferences: DEFAULT_PREFERENCES,
  appearance: DEFAULT_APPEARANCE,
  hotkeys: DEFAULT_HOTKEYS,
};

describe("settings snapshot", () => {
  it("serializes and reads a settings snapshot argument", () => {
    const argument = serializeSettingsSnapshotArgument(settings);

    expect(readSettingsSnapshotArgument(["electron", argument])).toEqual(
      settings,
    );
  });

  it("ignores missing or malformed settings snapshot arguments", () => {
    expect(readSettingsSnapshotArgument(["electron"])).toBeNull();
    expect(
      readSettingsSnapshotArgument(["electron", "--settings-snapshot=%"]),
    ).toBeNull();
    expect(
      readSettingsSnapshotArgument([
        "electron",
        `--settings-snapshot=${encodeURIComponent("{}")}`,
      ]),
    ).toBeNull();
  });
});
