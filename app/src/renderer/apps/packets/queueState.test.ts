import { describe, expect, it } from "vitest";

import { isValidQueuePacketDraft, replaceQueuePacketAt } from "./queueState";

describe("packet queue state", () => {
  it("rejects empty packet drafts", () => {
    expect(isValidQueuePacketDraft(" \n ")).toBe(false);
    expect(isValidQueuePacketDraft("%xt%zm%")).toBe(true);
  });

  it("replaces only an existing queue position", () => {
    const queue = ["first", "second"];

    expect(replaceQueuePacketAt(queue, 1, "updated")).toEqual([
      "first",
      "updated",
    ]);
    expect(replaceQueuePacketAt(queue, 2, "ignored")).toBe(queue);
  });
});
