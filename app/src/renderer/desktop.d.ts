import type { DesktopBridge } from "../shared/desktopBridge";

declare global {
  interface Window {
    readonly desktop: DesktopBridge;
  }
}
