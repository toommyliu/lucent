import { createContext, useContext } from "solid-js";

// Floating controls such as Select and Combobox portal their menus outside
// their local DOM tree. Dialogs publish their active positioner here so those
// menus can mount inside the dialog layer and stay above the dialog surface.
export interface DialogLayerState {
  readonly layer: number;
  readonly portalMount: () => HTMLElement | undefined;
  readonly setPortalMount: (element: HTMLElement | undefined) => void;
  readonly setNestedOpen: (id: number, open: boolean) => void;
}

const noopSetNestedOpen = (): void => undefined;
const noopSetPortalMount = (): void => undefined;
const noPortalMount = (): HTMLElement | undefined => undefined;

export const DialogLayerContext = createContext<DialogLayerState>({
  layer: 0,
  portalMount: noPortalMount,
  setPortalMount: noopSetPortalMount,
  setNestedOpen: noopSetNestedOpen,
});

export const dialogOverlayZIndex = (layer: number): number =>
  50 + Math.max(0, layer - 1) * 2;

export const dialogPositionerZIndex = (layer: number): number =>
  dialogOverlayZIndex(layer) + 1;

export const dialogFloatingZIndex = (layer: number): number =>
  dialogPositionerZIndex(layer) + 1;

export const useDialogPortalMount = (): (() => HTMLElement | undefined) =>
  useContext(DialogLayerContext).portalMount;

export const useDialogFloatingZIndex = (): number | undefined => {
  const layer = useContext(DialogLayerContext).layer;
  return layer > 0 ? dialogFloatingZIndex(layer) : undefined;
};
