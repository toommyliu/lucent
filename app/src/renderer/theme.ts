import {
  applyAppearanceSnapshotToDocument,
  createAppearanceSnapshot,
  getTextSizeTokens,
  resolveThemeVariant,
  rgbToCssValue,
} from "../shared/appearance-snapshot";
import type { Appearance, AppSettings, ThemeVariant } from "../shared/settings";

let activeAppearance: Appearance | null = null;

export interface RendererSettingsSync {
  readonly dispose: () => void;
}

export { getTextSizeTokens, rgbToCssValue };

export const resolveActiveThemeVariant = (
  appearance: Appearance,
): ThemeVariant => {
  return resolveThemeVariant(
    appearance,
    Boolean(globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches),
  );
};

export const applyAppearance = (appearance: Appearance): void => {
  activeAppearance = appearance;

  const root = document.documentElement;
  const variant = resolveActiveThemeVariant(appearance);
  applyAppearanceSnapshotToDocument(
    root,
    createAppearanceSnapshot(appearance, variant === "dark"),
  );
};

export const applySettings = (settings: AppSettings): void => {
  applyAppearance(settings.appearance);
};

export const installSettingsSync = (): RendererSettingsSync => {
  const bridge = window.desktop?.settings;
  if (!bridge) {
    return {
      dispose: () => {},
    };
  }

  let disposed = false;
  let changedDuringInitialLoad = false;
  const media = globalThis.matchMedia?.("(prefers-color-scheme: dark)") ?? null;
  const mediaListener = () => {
    if (activeAppearance?.themeMode === "system") {
      applyAppearance(activeAppearance);
    }
  };

  if (media) {
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", mediaListener);
    } else {
      media.addListener(mediaListener);
    }
  }

  if (bridge.initial) {
    applySettings(bridge.initial);
  }

  const unsubscribeSettings = bridge.onChanged((settings) => {
    if (!disposed) {
      changedDuringInitialLoad = true;
      applySettings(settings);
    }
  });

  void bridge
    .get()
    .then((settings) => {
      if (!changedDuringInitialLoad && !disposed) {
        applySettings(settings);
      }
    })
    .catch((error: unknown) => {
      console.error("Failed to load settings:", error);
    });

  const dispose = () => {
    if (disposed) {
      return;
    }

    disposed = true;
    unsubscribeSettings();

    if (!media) {
      return;
    }

    if (typeof media.removeEventListener === "function") {
      media.removeEventListener("change", mediaListener);
    } else {
      media.removeListener(mediaListener);
    }
  };

  return { dispose };
};
