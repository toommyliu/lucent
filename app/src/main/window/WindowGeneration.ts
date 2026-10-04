import type { WebContentsDidStartNavigationEventParams } from "electron";

export const INITIAL_WINDOW_GENERATION = 1;

type RendererNavigationListener = (
  details: Pick<
    WebContentsDidStartNavigationEventParams,
    "isSameDocument" | "isMainFrame"
  >,
) => void;

interface WindowGenerationWebContents {
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
  const handleNavigationStarted: RendererNavigationListener = ({
    isSameDocument,
    isMainFrame,
  }): void => {
    if (!isMainFrame || isSameDocument) {
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
    webContents.off("did-start-navigation", handleNavigationStarted);
  };
};
