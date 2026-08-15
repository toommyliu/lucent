import { describe, expect, it } from "@effect/vitest";

import { normalizeAppSettings, serializeAppSettings } from "./settings";

describe("settings", () => {
  it("normalizes and serializes the full appearance settings document", () => {
    const normalized = normalizeAppSettings({
      version: 0,
      preferences: {
        useGameTabs: true,
        launchMode: "account-manager",
      },
      hotkeys: {
        bindings: [{ id: "loadScript", value: "ctrl shift l" }],
      },
      appearance: {
        themeMode: "light",
        themes: {
          light: {
            tokens: {
              background: "#010203",
              ignoredToken: "#ffffff",
              primary: [10, 20, 30],
            },
            sansFontSize: 42,
            monoFontSize: 8,
            rounding: 4,
          },
          dark: {
            tokens: {
              background: "#0a0b0c",
            },
          },
        },
      },
    });
    const serialized = serializeAppSettings(normalized) as {
      readonly preferences: {
        readonly useGameTabs: boolean;
      };
      readonly appearance: {
        readonly themes: {
          readonly light: { readonly tokens: Record<string, string> };
          readonly dark: { readonly tokens: Record<string, string> };
        };
      };
    };

    expect(normalized.version).toBe(1);
    expect(normalized.preferences.useGameTabs).toBe(true);
    expect(normalized.preferences.launchMode).toBe("account-manager");
    expect(serialized.preferences.useGameTabs).toBe(true);
    expect(
      normalized.hotkeys.bindings.find(({ id }) => id === "loadScript")?.value,
    ).toBe("Control+Shift+L");
    expect(
      normalized.hotkeys.bindings.find(({ id }) => id === "toggleScriptsDialog")
        ?.value,
    ).toBe("Mod+Shift+S");
    expect(normalized.hotkeys.bindings).toHaveLength(23);
    expect(normalized.appearance.themeMode).toBe("light");
    expect(normalized.appearance.themes.light.tokens.background).toEqual([
      1, 2, 3,
    ]);
    expect(normalized.appearance.themes.light.tokens.primary).toEqual([
      10, 20, 30,
    ]);
    expect(normalized.appearance.themes.light.sansFontSize).toBe(24);
    expect(normalized.appearance.themes.light.monoFontSize).toBe(10);
    expect(normalized.appearance.themes.light.rounding).toBe(2);
    expect(serialized.appearance.themes.light.tokens["background"]).toBe(
      "#010203",
    );
    expect(serialized.appearance.themes.light.tokens).not.toHaveProperty(
      "ignoredToken",
    );
    expect(serialized.appearance.themes.dark.tokens["background"]).toBe(
      "#0a0b0c",
    );
  });
});
