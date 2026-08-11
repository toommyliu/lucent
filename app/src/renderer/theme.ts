import {
  applyAppearanceSnapshotToDocument,
  createAppearanceSnapshot,
} from "../shared/appearance";
import { DEFAULT_APP_SETTINGS, type AppSettings } from "@lucent/core/settings";

let activeSettings: AppSettings = DEFAULT_APP_SETTINGS;

export interface RendererThemeSync {
  readonly currentSettings: () => AppSettings;
  readonly dispose: () => void;
  readonly ready: Promise<AppSettings>;
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
  const bridge = window.desktop.settings;
  let disposed = false;
  let latestSettings = bridge.initial ?? DEFAULT_APP_SETTINGS;
  let settingsRevision = 0;
  activeSettings = latestSettings;
  const media = globalThis.matchMedia?.("(prefers-color-scheme: dark)") ?? null;
  const mediaListener = (): void => {
    if (activeSettings.appearance.themeMode === "system") {
      applySettingsAppearance(activeSettings);
    }
  };

  const unsubscribe = bridge.onChanged((settings) => {
    if (!disposed) {
      latestSettings = settings;
      settingsRevision += 1;
      applySettingsAppearance(settings);
    }
  });

  const revisionBeforeGet = settingsRevision;
  const ready = bridge
    .get()
    .then((settings) => {
      if (!disposed && settingsRevision === revisionBeforeGet) {
        latestSettings = settings;
        applySettingsAppearance(settings);
      }
      return latestSettings;
    })
    .catch((cause: unknown) => {
      console.error("Failed to reconcile renderer settings", cause);
      if (!disposed) {
        applySettingsAppearance(latestSettings);
      }
      return latestSettings;
    });

  media?.addEventListener("change", mediaListener);

  return {
    currentSettings: () => latestSettings,
    ready,
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
