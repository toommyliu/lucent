import { describe, expect, it } from "@effect/vitest";

import type { GameViewPresentation } from "../../shared/gameViews";
import type { ElectronGameViewHandle } from "../electron/ElectronGameView";
import type { ElectronNativeWindowHandle } from "../electron/ElectronWindow";
import {
  makeDesktopGameHosts,
  type DesktopGameHostRecord,
  type DesktopGameViewRecord,
} from "./DesktopGameHost";

interface Bounds {
  readonly height: number;
  readonly width: number;
  readonly x: number;
  readonly y: number;
}

const makeView = (
  onPresentation: (presentation: GameViewPresentation) => void = () => {},
) => {
  let bounds: Bounds = { height: 0, width: 0, x: 0, y: 0 };
  const view = {
    native: {},
    webContents: {
      focus: () => {},
      getZoomFactor: () => 1,
      isDestroyed: () => false,
      send: (_channel: string, presentation: GameViewPresentation) =>
        onPresentation(presentation),
    },
    getBounds: () => bounds,
    setBounds: (next: Bounds) => {
      bounds = next;
    },
    setBackgroundColor: () => {},
  };
  return view as unknown as ElectronGameViewHandle;
};

const makeHost = (ids: readonly string[]) => {
  const window = {
    contentView: { addChildView: () => {}, removeChildView: () => {} },
    getContentBounds: () => ({ height: 830, width: 1200, x: 0, y: 0 }),
    isDestroyed: () => false,
    isFocused: () => true,
  } as unknown as ElectronNativeWindowHandle;
  const presentations = new Map<string, GameViewPresentation[]>();
  const records = new Map<string, DesktopGameViewRecord>();
  for (const id of ids) {
    const sent: GameViewPresentation[] = [];
    presentations.set(id, sent);
    records.set(id, {
      boundsLayout: "focused",
      gameHostRendererId: 1,
      gamePartition: id,
      gameView: makeView((presentation) => sent.push(presentation)),
      gameViewPhase: "ready",
      generation: 0,
      hostWindow: window,
      kind: "game",
      rendererId: records.size + 2,
      rendererReady: true,
      stopObservingFocus: () => {},
      stopObservingReloads: () => {},
      stopObservingShortcutInput: () => {},
    });
  }
  const host: DesktopGameHostRecord = {
    closing: false,
    groupControlsNativeDialogOpen: false,
    groupControlsOpen: false,
    groupControlsView: makeView(),
    groupTargetIds: new Set(),
    hostView: makeView(),
    layout: "focused",
    orderedIds: [...ids],
    rendererId: 1,
    selectedId: ids[0] ?? "",
    shortcutModifierPressed: false,
    stopObservingShortcutInput: () => {},
    tabMenuOpen: false,
    window,
  };
  const hosts = makeDesktopGameHosts({
    getGameViewRecord: (id) => records.get(id),
    onShortcutError: () => {},
    onStateChanged: () => {},
    platform: "darwin",
  });
  hosts.refresh(host);
  const size = (id: string) => {
    const { height, width } = records.get(id)!.gameView.getBounds();
    return `${width}x${height}`;
  };
  const tiled = (id: string) => presentations.get(id)!.at(-1)?.tiled;
  const show = (
    layout: DesktopGameHostRecord["layout"],
    selectedId = host.selectedId,
  ) => {
    host.layout = layout;
    host.selectedId = selectedId;
    hosts.refresh(host);
  };
  return { show, size, tiled };
};

describe("game view layout", () => {
  it("resizes only the selected view when returning to the focused layout", () => {
    const { show, size, tiled } = makeHost(["a", "b", "c", "d"]);
    expect([size("a"), size("b")]).toEqual(["1200x800", "1200x800"]);

    show("grid");
    expect([size("a"), size("b"), size("c"), size("d")]).toEqual([
      "600x400",
      "600x400",
      "600x400",
      "600x400",
    ]);

    show("focused");
    expect([size("a"), size("b"), size("c"), size("d")]).toEqual([
      "1200x800",
      "600x400",
      "600x400",
      "600x400",
    ]);
    expect([tiled("a"), tiled("b")]).toEqual([false, true]);
  });

  it("keeps a view full size after another tab is selected", () => {
    const { show, size, tiled } = makeHost(["a", "b", "c"]);
    show("grid");
    show("focused", "b");
    show("focused", "a");

    expect([size("a"), size("b"), size("c")]).toEqual([
      "1200x800",
      "1200x800",
      "600x400",
    ]);
    expect([tiled("a"), tiled("b"), tiled("c")]).toEqual([false, false, true]);
  });
});
