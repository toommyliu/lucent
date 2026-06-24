import {
  isElectronWindowUsable,
  type ElectronWindowUsabilityTarget,
} from "../electron/windowUsability";

export interface RendererReloadWindowTarget extends ElectronWindowUsabilityTarget {
  readonly webContents: ElectronWindowUsabilityTarget["webContents"] & {
    readonly reloadIgnoringCache: () => void;
  };
}

export const reloadUsableRendererWindows = (
  windows: Iterable<RendererReloadWindowTarget>,
): number => {
  let reloadCount = 0;
  for (const window of windows) {
    if (!isElectronWindowUsable(window)) {
      continue;
    }

    window.webContents.reloadIgnoringCache();
    reloadCount += 1;
  }
  return reloadCount;
};
