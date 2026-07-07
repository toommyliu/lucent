import "../shared/polyfills";

import type { JSX } from "solid-js";
import { render } from "solid-js/web";

import type { AppPlatform } from "../shared/desktopBridge";
import type { AppSettings } from "../shared/settings";
import { installRendererThemeSync } from "./theme";

type RendererCleanup = () => void;

interface RendererLifecycleOptions {
  readonly cleanup?: RendererCleanup | readonly RendererCleanup[];
  readonly markReady?: boolean;
}

interface RendererMountOptions extends RendererLifecycleOptions {
  readonly app: () => JSX.Element;
}

export interface DesktopRendererProps {
  readonly initialSettings: AppSettings | null;
  readonly platform: AppPlatform;
}

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

const readDesktopRendererProps = (): DesktopRendererProps => ({
  initialSettings: window.desktop.settings.initial,
  platform: window.desktop.platform.os,
});

export const mountRenderer = (options: RendererMountOptions): void => {
  const themeSync = installRendererThemeSync();
  const root = document.getElementById("root");
  const disposeRender = root === null ? undefined : render(options.app, root);
  const cleanup = normalizeCleanup(options.cleanup);

  if (options.markReady ?? true) {
    document.documentElement.dataset["ready"] = "true";
  }

  window.addEventListener(
    "beforeunload",
    () => {
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

export const mountDesktopRenderer = (
  app: (props: DesktopRendererProps) => JSX.Element,
  options: RendererLifecycleOptions = {},
): void => {
  const desktopProps = readDesktopRendererProps();

  mountRenderer({
    ...options,
    app: () => app(desktopProps),
  });
};
