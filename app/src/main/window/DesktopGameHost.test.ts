import { describe, expect, it } from "@effect/vitest";
import { vi } from "vitest";
import * as Effect from "effect/Effect";
import type {
  GameViewLayout,
  GameViewPresentation,
} from "../../shared/gameViews";
import { GameViewsIpc } from "../../shared/ipc";
vi.mock("electron", () => ({}));
import { makeWindowHarness } from "./DesktopWindows.testing";

const makeHost = Effect.fn(function* (count: number) {
  const h = yield* makeWindowHarness();
  const ids: string[] = [];
  const rendererIds: number[] = [];
  for (let index = 0; index < count; index++) {
    const id = yield* h.windows.open("game", {
      gameHostTarget: { kind: "available" },
    });
    ids.push(id);
    rendererIds.push(yield* h.windows.getRendererId(id));
  }
  const hostId = yield* h.windows.getGameViewHostRendererId(rendererIds[0]!);
  const show = (layout: GameViewLayout, selected = 0) =>
    Effect.gen(function* () {
      yield* h.windows.selectGameView(hostId, ids[selected]!, "view");
      yield* h.windows.setGameViewLayout(hostId, layout);
    });
  yield* show("focused");
  const size = (index: number) => {
    const bounds = h.viewBounds.get(rendererIds[index]!)!;
    return `${bounds.width}x${bounds.height}`;
  };
  const contents = (index: number) =>
    h.contents.find((contents) => contents.id === rendererIds[index])!;
  const tiled = (index: number) =>
    (
      contents(index).sent.findLast(
        (item) => item.channel === GameViewsIpc.presentationChanged.channel,
      )!.payload as GameViewPresentation
    ).tiled;
  const resize = (width: number, height: number) => {
    h.nativeWindows[0]!.getContentBounds = () => ({
      x: 0,
      y: 0,
      width,
      height,
    });
    h.nativeWindows[0]!.emit("resized");
  };
  return {
    ...h,
    ids,
    rendererIds,
    hostId,
    show,
    size,
    tiled,
    resize,
    activate: (index: number) => contents(index).focus(),
  };
});

describe("game view layout", () => {
  it.effect(
    "resizes only the selected view when returning to the focused layout",
    () =>
      Effect.gen(function* () {
        const h = yield* makeHost(4);
        expect([h.size(0), h.size(1)]).toEqual(["1024x768", "1024x768"]);
        yield* h.show("grid");
        expect([h.size(0), h.size(1), h.size(2), h.size(3)]).toEqual([
          "512x384",
          "512x384",
          "512x384",
          "512x384",
        ]);
        yield* h.show("focused");
        expect([h.size(0), h.size(1), h.size(2), h.size(3)]).toEqual([
          "1024x768",
          "512x384",
          "512x384",
          "512x384",
        ]);
        expect([h.tiled(0), h.tiled(1)]).toEqual([false, true]);
      }),
  );
  it.effect("keeps a view full size after another tab is selected", () =>
    Effect.gen(function* () {
      const h = yield* makeHost(3);
      yield* h.show("grid");
      yield* h.show("focused", 1);
      yield* h.show("focused", 0);
      expect([h.size(0), h.size(1), h.size(2)]).toEqual([
        "1024x768",
        "1024x768",
        "512x384",
      ]);
      expect([h.tiled(0), h.tiled(1), h.tiled(2)]).toEqual([
        false,
        false,
        true,
      ]);
    }),
  );
  it.effect("leaves hidden tiles alone when the focused window resizes", () =>
    Effect.gen(function* () {
      const h = yield* makeHost(3);
      yield* h.show("grid");
      yield* h.show("focused", 1);
      yield* h.show("focused", 0);
      h.resize(1000, 630);
      expect([h.size(0), h.size(1), h.size(2)]).toEqual([
        "1000x600",
        "1000x600",
        "512x384",
      ]);
    }),
  );
  it.effect(
    "shows a tile's top nav once a window resize brings it to full size",
    () =>
      Effect.gen(function* () {
        const h = yield* makeHost(2);
        yield* h.show("grid");
        yield* h.show("focused", 0);
        h.activate(1);
        h.resize(1000, 630);
        expect([h.size(1), h.tiled(1)]).toEqual(["1000x600", false]);
      }),
  );
  it.effect(
    "keeps selection and group targets valid when tabs are reordered and closed",
    () =>
      Effect.gen(function* () {
        const h = yield* makeHost(3);
        yield* h.windows.setGameViewGroupTargets(h.hostId, [
          h.ids[0]!,
          h.ids[2]!,
        ]);
        yield* h.windows.reorderGameViews(h.hostId, [
          h.ids[2]!,
          h.ids[0]!,
          h.ids[1]!,
        ]);
        yield* h.windows.closeGameView(h.hostId, h.ids[0]!);
        const state = yield* h.windows.getGameViewHostState(h.hostId);
        expect(state.sessions.map((view) => view.id)).toEqual([
          h.ids[2],
          h.ids[1],
        ]);
        expect(state.selectedId).toBe(h.ids[1]);
        expect(state.groupTargetIds).toEqual([h.ids[2]]);
        expect(
          yield* h.windows
            .reorderGameViews(h.hostId, [h.ids[1]!, h.ids[1]!])
            .pipe(Effect.isFailure),
        ).toBe(true);
      }),
  );
});
