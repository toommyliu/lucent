import { BrowserWindow, app, screen } from "electron";
import type { ElectronWindowRuntime } from "./WindowTypes";

const getCursorDisplayWorkArea = () => {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  return display.workArea;
};

export const makeElectronWindowRuntime = (): ElectronWindowRuntime => ({
  platform: process.platform,
  createWindow: (options) => new BrowserWindow(options),
  fromId: (id) => BrowserWindow.fromId(id),
  getAllWindows: () => BrowserWindow.getAllWindows(),
  getFocusedWindow: () => BrowserWindow.getFocusedWindow(),
  getCursorDisplayWorkArea,
  getCenteredPosition: (width, height) => {
    const workArea = getCursorDisplayWorkArea();
    return {
      x: Math.floor(workArea.x + (workArea.width - width) / 2),
      y: Math.floor(workArea.y + (workArea.height - height) / 2),
    };
  },
  focusApp: () => app.focus({ steal: true }),
});
