import {
  applyAppearanceSnapshotToDocument,
  createAppearanceSnapshot,
} from "../shared/appearance";
import { DEFAULT_APP_SETTINGS, type AppSettings } from "../shared/settings";

let activeSettings: AppSettings = DEFAULT_APP_SETTINGS;

export interface RendererThemeSync {
  readonly dispose: () => void;
}

export const resolveSystemPrefersDark = (): boolean =>
  Boolean(globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches);

export const applySettingsAppearance = (settings: AppSettings): void => {
  activeSettings = settings;
  applyAppearanceSnapshotToDocument(
    document.documentElement,
    createAppearanceSnapshot(settings, resolveSystemPrefersDark()),
  );
};

export const installRendererThemeSync = (): RendererThemeSync => {
  const bridge = window.desktop?.settings;
  if (bridge === undefined) {
    applySettingsAppearance(DEFAULT_APP_SETTINGS);
    return { dispose: () => undefined };
  }

  let disposed = false;
  const media = globalThis.matchMedia?.("(prefers-color-scheme: dark)") ?? null;
  const mediaListener = (): void => {
    if (activeSettings.appearance.themeMode === "system") {
      applySettingsAppearance(activeSettings);
    }
  };

  if (bridge.initial !== null) {
    applySettingsAppearance(bridge.initial);
  }

  const unsubscribe = bridge.onChanged((settings) => {
    if (!disposed) {
      applySettingsAppearance(settings);
    }
  });

  void bridge
    .get()
    .then((settings) => {
      if (!disposed) {
        applySettingsAppearance(settings);
      }
    })
    .catch((cause: unknown) => {
      console.error("Failed to reconcile renderer settings", cause);
    });

  media?.addEventListener("change", mediaListener);

  return {
    dispose: () => {
      if (disposed) {
        return;
      }
      disposed = true;
      unsubscribe();
      media?.removeEventListener("change", mediaListener);
    },
  };
};
