import "../shared/immediate";

import type { AppSettings } from "@lucent/core/settings";
import { installRendererThemeSync } from "./theme";

performance.mark("lucent.renderer.bootstrap");

export type RendererCleanup = () => void;

export interface RendererLifecycleOptions {
  readonly cleanup?: RendererCleanup | readonly RendererCleanup[];
  readonly markReady?: boolean;
}

export type RenderRoot = (
  root: HTMLElement,
  settings: AppSettings,
) => RendererCleanup;

const normalizeCleanup = (
  cleanup: RendererLifecycleOptions["cleanup"],
): readonly RendererCleanup[] => {
  if (cleanup === undefined) {
    return [];
  }

  return typeof cleanup === "function" ? [cleanup] : cleanup;
};

const runCleanup = (cleanup: RendererCleanup): void => {
  try {
    cleanup();
  } catch (cause) {
    console.error("[renderer] cleanup failed", cause);
  }
};

export const startRenderer = (
  renderRoot: RenderRoot,
  options: RendererLifecycleOptions,
): void => {
  const themeSync = installRendererThemeSync();
  const cleanup = normalizeCleanup(options.cleanup);
  let disposed = false;
  let disposeRender: RendererCleanup | undefined;

  void themeSync.ready.then(() => {
    if (disposed) {
      return;
    }

    const root = document.getElementById("root");
    disposeRender =
      root === null ? undefined : renderRoot(root, themeSync.currentSettings());
    performance.mark("lucent.renderer.mounted");

    if (options.markReady ?? true) {
      document.documentElement.dataset["ready"] = "true";
      performance.mark("lucent.renderer.ready");
    }
  });

  window.addEventListener(
    "beforeunload",
    () => {
      disposed = true;
      for (const dispose of cleanup) {
        runCleanup(dispose);
      }

      if (disposeRender !== undefined) {
        runCleanup(disposeRender);
      }

      runCleanup(themeSync.dispose);
    },
    { once: true },
  );
};
