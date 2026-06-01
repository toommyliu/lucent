import { render } from "solid-js/web";
import type { JSX } from "solid-js";
import { installSettingsSync } from "../theme";
import {
  durationSince,
  startupNow,
  writeRendererStartupTiming,
} from "../startup-timing";
import type { AppPlatform } from "../../shared/ipc";
import type { AppSettings } from "../../shared/settings";

export interface WindowMountContext {
  readonly initialSettings: AppSettings | null;
  readonly platform: AppPlatform;
}

const markReady = (): void => {
  document.documentElement.dataset["ready"] = "true";
};

export function mountWindow(
  App: (context: WindowMountContext) => JSX.Element,
): void {
  const mountStartedAt = startupNow();
  const root = document.getElementById("root");
  const settingsSync = installSettingsSync();
  let disposed = false;
  let disposeRender: (() => void) | undefined;

  const cleanup = () => {
    if (disposed) {
      return;
    }

    disposed = true;
    disposeRender?.();
    settingsSync.dispose();
    window.removeEventListener("beforeunload", cleanup);
  };

  window.addEventListener("beforeunload", cleanup, { once: true });

  if (!root) {
    cleanup();
    markReady();
    writeRendererStartupTiming("renderer-startup", "Renderer mount skipped", {
      reason: "missing-root",
      totalMs: durationSince(mountStartedAt),
    });
    return;
  }

  let renderMs: number | undefined;
  let mounted = false;
  try {
    const renderStartedAt = startupNow();
    disposeRender = render(
      () =>
        App({
          initialSettings: window.ipc.settings.initial,
          platform: window.ipc.platform.os,
        }),
      root,
    );
    renderMs = durationSince(renderStartedAt);
    mounted = true;
  } catch (error: unknown) {
    console.error("Failed to mount renderer window:", error);
    cleanup();
  } finally {
    const initialSettings = window.ipc?.settings?.initial;
    markReady();
    writeRendererStartupTiming("renderer-startup", "Renderer mount completed", {
      initialSettingsPresent:
        initialSettings !== null && initialSettings !== undefined,
      mounted,
      renderMs,
      totalMs: durationSince(mountStartedAt),
    });
  }
}
