import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { observeWindowReloads } from "./WindowGeneration";

describe("window reload generations", () => {
  it("advances only for a new main-frame document after initial navigation", () => {
    const contents = Object.assign(new EventEmitter(), {
      isDestroyed: () => false,
    });
    const generations: number[] = [];
    const stop = observeWindowReloads(contents, (generation) =>
      generations.push(generation),
    );
    const navigate = (isMainFrame: boolean, isSameDocument: boolean) =>
      contents.emit("did-start-navigation", { isMainFrame, isSameDocument });

    navigate(false, false);
    navigate(true, true);
    navigate(true, false);
    expect(generations).toEqual([]);
    navigate(false, false);
    navigate(true, true);
    expect(generations).toEqual([]);
    navigate(true, false);
    navigate(true, false);
    expect(generations).toEqual([2, 3]);
    stop();
    navigate(true, false);
    expect(generations).toEqual([2, 3]);
  });
});
