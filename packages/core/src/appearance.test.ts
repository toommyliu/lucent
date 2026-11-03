import { describe, expect, it } from "@effect/vitest";

import {
  createAppearanceSnapshot,
  hexToRgb,
  pickOnAccentColor,
  resolveTextMixFloor,
  resolveThemeColors,
  readAppearanceSnapshotArgument,
  rgbEquals,
  rgbToCssValue,
  rgbToHex,
  serializeAppearanceSnapshotArgument,
} from "./appearance";
import {
  DEFAULT_APP_SETTINGS,
  DEFAULT_THEME_COLORS,
  normalizeAppSettings,
} from "./settings";

describe("appearance bootstrap", () => {
  it("creates a dark fallback snapshot", () => {
    const snapshot = createAppearanceSnapshot(DEFAULT_APP_SETTINGS, true);

    expect(snapshot.backgroundColor).toBe("#0e0e10");
    expect(snapshot.variant).toBe("dark");
    expect(snapshot.colors).toEqual({});
    expect(snapshot.sansFont).toBe(
      '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    );
    expect(snapshot.monoFont).toBe(
      'ui-monospace, "SFMono-Regular", "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
    );
    expect(snapshot.sansFontSize).toBe(14);
    expect(snapshot.monoFontSize).toBe(12);
  });

  it("resolves each font independently for the selected theme", () => {
    const settings = normalizeAppSettings({
      version: 2,
      appearance: {
        themeMode: "system",
        themes: {
          light: { sansFont: "Custom Sans" },
          dark: { monoFont: "Custom Mono" },
        },
      },
    });

    expect(createAppearanceSnapshot(settings, false)).toMatchObject({
      sansFont: "Custom Sans",
      monoFont:
        'ui-monospace, "SFMono-Regular", "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
    });
    expect(createAppearanceSnapshot(settings, true)).toMatchObject({
      sansFont: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      monoFont: "Custom Mono",
    });
  });

  it("resolves defaults separately from sparse snapshot overrides", () => {
    const settings = normalizeAppSettings({
      version: 2,
      appearance: {
        themeMode: "system",
        themes: {
          light: { colors: { accent: "#123456" } },
          dark: { colors: { background: "#010203" } },
        },
      },
    });

    expect(resolveThemeColors(settings, "light")).toEqual({
      background: [248, 248, 250],
      foreground: [25, 25, 28],
      accent: [18, 52, 86],
    });
    expect(resolveThemeColors(settings, "dark")).toEqual({
      background: [1, 2, 3],
      foreground: [243, 243, 245],
      accent: [243, 243, 245],
    });
    expect(createAppearanceSnapshot(settings, false)).toMatchObject({
      variant: "light",
      colors: { accent: [18, 52, 86] },
      backgroundColor: "#f8f8fa",
    });
    expect(createAppearanceSnapshot(settings, true)).toMatchObject({
      variant: "dark",
      colors: { background: [1, 2, 3] },
      backgroundColor: "#010203",
    });
  });

  it("formats, parses, and compares theme colors", () => {
    expect(rgbToCssValue([1, 2, 3])).toBe("1, 2, 3");
    expect(rgbToHex([1, 2, 3])).toBe("#010203");

    expect(hexToRgb("#0a0B0c")).toEqual([10, 11, 12]);
    expect(hexToRgb("0a0b0c")).toEqual([10, 11, 12]);
    expect(hexToRgb("#abc")).toBeNull();
    expect(hexToRgb("#not-a-color")).toBeNull();

    expect(rgbEquals([1, 2, 3], [1, 2, 3])).toBe(true);
    expect(rgbEquals([1, 2, 3], [1, 2, 4])).toBe(false);
  });

  it("decodes snapshot arguments through the snapshot schema", () => {
    const snapshot = createAppearanceSnapshot(DEFAULT_APP_SETTINGS, true);
    const argument = serializeAppearanceSnapshotArgument(snapshot);

    expect(readAppearanceSnapshotArgument([argument])).toEqual(snapshot);
    expect(
      readAppearanceSnapshotArgument([
        `--lucent__appearance=${encodeURIComponent(
          JSON.stringify({ ...snapshot, colors: { accent: [256, 0, 0] } }),
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

describe("theme contrast", () => {
  const white = [255, 255, 255];
  const nearBlack = [25, 25, 28];

  it("puts white text on saturated mid-tone accents", () => {
    expect(pickOnAccentColor([59, 130, 246])).toEqual(white);
    expect(pickOnAccentColor([239, 68, 68])).toEqual(white);
    expect(pickOnAccentColor([25, 25, 28])).toEqual(white);
  });

  it("puts dark text on light accents", () => {
    expect(pickOnAccentColor([34, 197, 94])).toEqual(nearBlack);
    expect(pickOnAccentColor([255, 255, 0])).toEqual(nearBlack);
    expect(pickOnAccentColor([243, 243, 245])).toEqual(nearBlack);
  });

  it("keeps the default dark text steps", () => {
    const { background, foreground } = DEFAULT_THEME_COLORS.dark;

    expect(resolveTextMixFloor(background, foreground)).toBeLessThan(57);
  });

  it("lifts secondary text for a low-contrast pair", () => {
    expect(resolveTextMixFloor([245, 240, 228], [70, 70, 70])).toBeGreaterThan(
      67,
    );
  });

  it("uses the text color when no mix reaches the contrast target", () => {
    expect(resolveTextMixFloor([120, 120, 120], [160, 160, 160])).toBe(100);
  });
});
