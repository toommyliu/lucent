import { BaseWindow, screen, type Rectangle } from "electron";

/**
 * Returns the work area new windows should open in: the focused Lucent
 * window's display, or the cursor's display when no Lucent window is focused.
 */
export const resolvePlacementWorkArea = (): Rectangle => {
  const focused = BaseWindow.getFocusedWindow();
  return focused === null
    ? screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
    : screen.getDisplayMatching(focused.getBounds()).workArea;
};
