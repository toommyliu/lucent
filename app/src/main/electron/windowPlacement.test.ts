import { afterEach, describe, expect, it, vi } from "vitest";

import { resolvePlacementWorkArea } from "./windowPlacement";

const electronMock = vi.hoisted(() => {
  const primary = {
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    workArea: { x: 0, y: 25, width: 1920, height: 1055 },
  };
  const secondary = {
    bounds: { x: 1920, y: 0, width: 2560, height: 1440 },
    workArea: { x: 1920, y: 0, width: 2560, height: 1400 },
  };
  const displayAt = (point: { readonly x: number }) =>
    point.x >= secondary.bounds.x ? secondary : primary;
  return {
    cursor: { x: 0, y: 0 },
    focused: null as null | {
      getBounds: () => { x: number; y: number; width: number; height: number };
    },
    displayAt,
    primary,
    secondary,
  };
});

vi.mock("electron", () => ({
  BaseWindow: {
    getFocusedWindow: () => electronMock.focused,
  },
  screen: {
    getCursorScreenPoint: () => electronMock.cursor,
    getDisplayMatching: (rect: { readonly x: number }) =>
      electronMock.displayAt(rect),
    getDisplayNearestPoint: (point: { readonly x: number }) =>
      electronMock.displayAt(point),
  },
}));

afterEach(() => {
  electronMock.cursor = { x: 0, y: 0 };
  electronMock.focused = null;
});

describe("resolvePlacementWorkArea", () => {
  it("uses the focused window's display instead of the cursor's", () => {
    electronMock.cursor = { x: 100, y: 100 };
    electronMock.focused = {
      getBounds: () => ({ x: 2200, y: 200, width: 1024, height: 768 }),
    };

    expect(resolvePlacementWorkArea()).toEqual(
      electronMock.secondary.workArea,
    );
  });

  it("uses the cursor's display when no window is focused", () => {
    electronMock.cursor = { x: 2500, y: 100 };

    expect(resolvePlacementWorkArea()).toEqual(
      electronMock.secondary.workArea,
    );
  });
});
