/** @jsxImportSource react */
import "@lucent/ui-react/styles.css";
import "./react.css";

import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

import type { AppSettings } from "@lucent/core/settings";
import {
  startRenderer,
  type RendererLifecycleOptions,
} from "./rendererLifecycle";

interface ReactRendererMountOptions extends RendererLifecycleOptions {
  readonly app: (settings: AppSettings) => ReactNode;
}

export const mountReactRenderer = (
  options: ReactRendererMountOptions,
): void => {
  startRenderer((root, settings) => {
    const reactRoot = createRoot(root);
    reactRoot.render(<StrictMode>{options.app(settings)}</StrictMode>);
    return () => reactRoot.unmount();
  }, options);
};
