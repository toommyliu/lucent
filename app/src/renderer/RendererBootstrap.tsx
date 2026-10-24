import type { JSX } from "solid-js";
import { render } from "solid-js/web";

import type { AppPlatform } from "../shared/desktopBridge";
import type { AppSettings } from "@lucent/core/settings";
import {
  startRenderer,
  type RendererLifecycleOptions,
} from "./rendererLifecycle";

interface RendererMountOptions extends RendererLifecycleOptions {
  readonly app: (settings: AppSettings) => JSX.Element;
}

export interface DesktopRendererProps {
  readonly initialSettings: AppSettings | null;
  readonly platform: AppPlatform;
}

const readDesktopRendererProps = (
  initialSettings: AppSettings,
): DesktopRendererProps => ({
  initialSettings,
  platform: window.desktop.platform.os,
});

export const mountRenderer = (options: RendererMountOptions): void => {
  startRenderer(
    (root, settings) => render(() => options.app(settings), root),
    options,
  );
};

export const mountDesktopRenderer = (
  app: (props: DesktopRendererProps) => JSX.Element,
  options: RendererLifecycleOptions = {},
): void => {
  mountRenderer({
    ...options,
    app: (settings) => app(readDesktopRendererProps(settings)),
  });
};
