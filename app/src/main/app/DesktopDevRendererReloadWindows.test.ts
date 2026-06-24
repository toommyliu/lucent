import { describe, expect, it } from "@effect/vitest";

import {
  reloadUsableRendererWindows,
  type RendererReloadWindowTarget,
} from "./DesktopDevRendererReloadWindows";

const makeWindow = (input: {
  readonly destroyed?: boolean;
  readonly webContentsDestroyed?: boolean;
  readonly onReload: () => void;
}): RendererReloadWindowTarget => ({
  isDestroyed: () => input.destroyed ?? false,
  webContents: {
    isDestroyed: () => input.webContentsDestroyed ?? false,
    reloadIgnoringCache: input.onReload,
  },
});

describe("reloadUsableRendererWindows", () => {
  it("reloads only windows that can still receive renderer messages", () => {
    const reloaded: number[] = [];
    const count = reloadUsableRendererWindows([
      makeWindow({ onReload: () => reloaded.push(1) }),
      makeWindow({ destroyed: true, onReload: () => reloaded.push(2) }),
      makeWindow({
        webContentsDestroyed: true,
        onReload: () => reloaded.push(3),
      }),
    ]);

    expect(count).toBe(1);
    expect(reloaded).toEqual([1]);
  });
});
