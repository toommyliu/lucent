export interface ElectronWindowUsabilityTarget {
  readonly isDestroyed: () => boolean;
  readonly webContents: {
    readonly isDestroyed: () => boolean;
  };
}

export const isElectronWindowUsable = <
  Window extends ElectronWindowUsabilityTarget,
>(
  window: Window | undefined,
): window is Window =>
  window !== undefined &&
  !window.isDestroyed() &&
  !window.webContents.isDestroyed();
