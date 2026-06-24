import { describe, expect, it } from "@effect/vitest";

import {
  applyAppearanceSnapshotToDocument,
  createAppearanceSnapshot,
  readAppearanceSnapshotArgument,
  rgbToHex,
  serializeAppearanceSnapshotArgument,
} from "./appearance";
import { DEFAULT_APP_SETTINGS } from "./settings";

describe("appearance bootstrap", () => {
  it("creates a dark fallback snapshot and applies it to the root element", () => {
    const snapshot = createAppearanceSnapshot(DEFAULT_APP_SETTINGS, true);
    const properties = new Map<string, string>();
    let darkClass = false;
    const root = {
      classList: {
        toggle: (name: string, active: boolean) => {
          if (name === "dark") {
            darkClass = active;
          }
        },
      },
      dataset: {} as Record<string, string>,
      style: {
        setProperty: (name: string, value: string) => {
          properties.set(name, value);
        },
      },
    } as unknown as HTMLElement;

    applyAppearanceSnapshotToDocument(root, snapshot);

    expect(snapshot.backgroundColor).toBe(
      rgbToHex(DEFAULT_APP_SETTINGS.appearance.themes.dark.tokens.background),
    );
    expect(root.dataset["theme"]).toBe("dark");
    expect(darkClass).toBe(true);
    expect(properties.get("color-scheme")).toBe("dark");
    expect(properties.get("--background")).toBe(
      DEFAULT_APP_SETTINGS.appearance.themes.dark.tokens.background.join(", "),
    );
  });

  it("decodes snapshot arguments through the snapshot schema", () => {
    const snapshot = createAppearanceSnapshot(DEFAULT_APP_SETTINGS, true);
    const argument = serializeAppearanceSnapshotArgument(snapshot);

    expect(readAppearanceSnapshotArgument([argument])).toEqual(snapshot);
    expect(
      readAppearanceSnapshotArgument([
        `--lucent__appearance=${encodeURIComponent(
          JSON.stringify({ ...snapshot, tokens: {} }),
        )}`,
      ]),
    ).toBeNull();
    expect(
      readAppearanceSnapshotArgument([
        `--lucent__appearance=${encodeURIComponent(
          JSON.stringify({ ...snapshot, sansFontSize: 42 }),
        )}`,
      ]),
    ).toBeNull();
    expect(
      readAppearanceSnapshotArgument([
        `--lucent__appearance=${encodeURIComponent(
          JSON.stringify({ ...snapshot, rounding: 4 }),
        )}`,
      ]),
    ).toBeNull();
  });
});
