export const INITIAL_WINDOW_GENERATION = 1;

type RendererNavigationListener = (
  event: unknown,
  url: string,
  isInPlace: boolean,
  isMainFrame: boolean,
  frameProcessId: number,
  frameRoutingId: number,
) => void;

interface WindowGenerationWebContents {
  readonly isDestroyed: () => boolean;
  readonly off: (
    event: "did-start-navigation",
    listener: RendererNavigationListener,
  ) => unknown;
  readonly on: (
    event: "did-start-navigation",
    listener: RendererNavigationListener,
  ) => unknown;
}

export const observeWindowReloads = (
  webContents: WindowGenerationWebContents,
  onReload: (generation: number) => void,
): (() => void) => {
  let generation = INITIAL_WINDOW_GENERATION;
  let initialNavigationStarted = false;
  let observing = true;
  const handleNavigationStarted: RendererNavigationListener = (
    _event,
    _url,
    isInPlace,
    isMainFrame,
  ): void => {
    if (!isMainFrame || isInPlace) {
      return;
    }
    if (!initialNavigationStarted) {
      initialNavigationStarted = true;
      return;
    }

    generation += 1;
    onReload(generation);
  };

  webContents.on("did-start-navigation", handleNavigationStarted);

  return () => {
    if (!observing) {
      return;
    }

    observing = false;
    if (!webContents.isDestroyed()) {
      webContents.off("did-start-navigation", handleNavigationStarted);
    }
  };
};
