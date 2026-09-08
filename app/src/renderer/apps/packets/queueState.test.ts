import { describe, expect, it } from "@effect/vitest";

import { replaceQueuePacketAt } from "./queueState";

describe("packet queue state", () => {
  it("replaces only an existing queue position", () => {
    const queue = ["first", "second"];

    expect(replaceQueuePacketAt(queue, 1, "updated")).toEqual([
      "first",
      "updated",
    ]);
    expect(replaceQueuePacketAt(queue, 2, "ignored")).toBe(queue);
  });
});
