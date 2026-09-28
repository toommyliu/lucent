import { afterEach, describe, expect, it } from "vitest";

import { makeMessageChannelImmediate, type Immediate } from "./immediate";

describe("makeMessageChannelImmediate", () => {
  let immediate: Immediate | undefined;

  afterEach(() => {
    immediate?.close();
    immediate = undefined;
  });

  it("runs callbacks asynchronously in scheduling order", async () => {
    const { setImmediate } = (immediate = makeMessageChannelImmediate());
    const calls: number[] = [];

    const done = new Promise<void>((resolve) => {
      setImmediate(() => calls.push(1));
      setImmediate(() => {
        calls.push(2);
        resolve();
      });
    });
    expect(calls).toEqual([]);

    await done;
    expect(calls).toEqual([1, 2]);
  });

  it("passes extra arguments to the callback", async () => {
    const { setImmediate } = (immediate = makeMessageChannelImmediate());

    const received = await new Promise<readonly [string, number]>((resolve) => {
      setImmediate(
        (label: string, count: number) => resolve([label, count]),
        "expected",
        2,
      );
    });

    expect(received).toEqual(["expected", 2]);
  });

  it("skips cleared callbacks", async () => {
    const { setImmediate, clearImmediate } = (immediate =
      makeMessageChannelImmediate());
    const calls: string[] = [];

    const done = new Promise<void>((resolve) => {
      clearImmediate(setImmediate(() => calls.push("cleared")));
      setImmediate(() => {
        calls.push("kept");
        resolve();
      });
    });

    await done;
    expect(calls).toEqual(["kept"]);
  });
});
