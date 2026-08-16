import { createMemo, createSignal, type Accessor, type JSX } from "solid-js";

interface PositioningUpdateDetails {
  readonly floatingElement: HTMLElement | null;
  readonly updatePosition: () => Promise<void>;
}

interface PositioningPlacedDetails {
  readonly placed: boolean;
}

interface PositioningLifecycleOptions {
  readonly onPositioned?:
    | ((details: PositioningPlacedDetails) => void)
    | undefined;
  readonly updatePosition?:
    | ((details: PositioningUpdateDetails) => Promise<void> | void)
    | undefined;
}

/** Tracks whether an anchored overlay has coordinates for its current opening. */
export function createPositioningReady<T extends object>(
  options: Accessor<T & PositioningLifecycleOptions>,
) {
  const [positioned, setPositioned] = createSignal(false);
  let floatingElement: HTMLElement | null = null;
  let generation = 0;
  const positioning = createMemo(() => {
    const supplied = options();
    return {
      ...supplied,
      async updatePosition(details: PositioningUpdateDetails): Promise<void> {
        const currentGeneration = generation;
        const currentFloatingElement = details.floatingElement;
        if (currentFloatingElement !== floatingElement) {
          floatingElement = currentFloatingElement;
          setPositioned(false);
          currentFloatingElement?.style.removeProperty("--x");
          currentFloatingElement?.style.removeProperty("--y");
        }

        if (supplied.updatePosition === undefined) {
          await details.updatePosition();
        } else {
          await supplied.updatePosition(details);
        }

        const hasCoordinates =
          currentFloatingElement !== null &&
          currentFloatingElement.style.getPropertyValue("--x") !== "" &&
          currentFloatingElement.style.getPropertyValue("--y") !== "";
        if (
          currentGeneration === generation &&
          currentFloatingElement === floatingElement &&
          currentFloatingElement?.isConnected === true &&
          hasCoordinates
        ) {
          setPositioned(true);
          supplied.onPositioned?.({ placed: true });
        }
      },
      onPositioned(details: PositioningPlacedDetails): void {
        if (details.placed) return;

        generation += 1;
        setPositioned(false);
        floatingElement?.style.removeProperty("--x");
        floatingElement?.style.removeProperty("--y");
        floatingElement = null;
        supplied.onPositioned?.(details);
      },
    };
  });

  return { positioned, positioning };
}

/** Prevents an unpositioned overlay from painting or accepting pointer input. */
export function getPositionerStyle(
  positioned: boolean,
  zIndex?: number,
): JSX.CSSProperties {
  const style: JSX.CSSProperties = {};
  if (!positioned) {
    style.opacity = 0;
    style["pointer-events"] = "none";
  }
  if (zIndex !== undefined) {
    style["z-index"] = zIndex;
  }
  return style;
}
