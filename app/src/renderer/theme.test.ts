// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppBridge } from "../shared/ipc";
import {
  DEFAULT_APPEARANCE,
  DEFAULT_HOTKEYS,
  DEFAULT_PREFERENCES,
  type AppSettings,
} from "../shared/settings";
import { getTextSizeTokens, installSettingsSync } from "./theme";

const settings: AppSettings = {
  preferences: DEFAULT_PREFERENCES,
  appearance: DEFAULT_APPEARANCE,
  hotkeys: DEFAULT_HOTKEYS,
};

describe("renderer typography tokens", () => {
  it("derives text size tokens from the configured sans base size", () => {
    expect(getTextSizeTokens(13)).toEqual({
      "--text-2xs": "10px",
      "--text-xs": "11px",
      "--text-sm": "12px",
      "--text-base": "13px",
      "--text-md": "14px",
      "--text-lg": "15px",
      "--text-xl": "16px",
      "--text-2xl": "18px",
      "--text-3xl": "20px",
      "--text-4xl": "24px",
      "--text-5xl": "28px",
    });

    expect(getTextSizeTokens(20)).toMatchObject({
      "--text-sm": "18.4615px",
      "--text-base": "20px",
      "--text-5xl": "43.0769px",
    });
  });
});

describe("renderer settings sync", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.className = "";
    document.documentElement.removeAttribute("style");
  });

  it("applies the initial settings snapshot without waiting for settings get", () => {
    let changedListener: ((nextSettings: AppSettings) => void) | undefined;
    const get = vi.fn(() => new Promise<AppSettings>(() => undefined));
    Object.defineProperty(window, "ipc", {
      configurable: true,
      value: {
        settings: {
          initial: settings,
          get,
          onChanged: (listener: (nextSettings: AppSettings) => void) => {
            changedListener = listener;
            return () => {
              changedListener = undefined;
            };
          },
        },
      } as unknown as AppBridge,
    });

    const sync = installSettingsSync();

    expect(get).toHaveBeenCalledOnce();
    expect(document.documentElement.dataset["theme"]).toBe("dark");

    changedListener?.({
      ...settings,
      appearance: { ...settings.appearance, themeMode: "light" },
    });

    expect(document.documentElement.dataset["theme"]).toBe("light");

    sync.dispose();
    expect(changedListener).toBeUndefined();
  });
});
