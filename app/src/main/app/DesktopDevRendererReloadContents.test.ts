import { describe, expect, it } from "@effect/vitest";

import {
  reloadUsableRendererContents,
  type RendererReloadContentTarget,
} from "./DesktopDevRendererReloadContents";

const makeContents = (input: {
  readonly destroyed?: boolean;
  readonly type: ReturnType<RendererReloadContentTarget["getType"]>;
  readonly onReload: () => void;
}): RendererReloadContentTarget => ({
  getType: () => input.type,
  isDestroyed: () => input.destroyed ?? false,
  reloadIgnoringCache: input.onReload,
});

describe("reloadUsableRendererContents", () => {
  it("reloads app windows and BrowserViews only while usable", () => {
    const reloaded: number[] = [];
    const count = reloadUsableRendererContents([
      makeContents({ type: "window", onReload: () => reloaded.push(1) }),
      makeContents({ type: "browserView", onReload: () => reloaded.push(2) }),
      makeContents({
        destroyed: true,
        type: "browserView",
        onReload: () => reloaded.push(3),
      }),
      makeContents({ type: "remote", onReload: () => reloaded.push(4) }),
    ]);

    expect(count).toBe(2);
    expect(reloaded).toEqual([1, 2]);
  });
});
