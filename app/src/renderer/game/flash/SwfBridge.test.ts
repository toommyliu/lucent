import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { vi } from "vitest";

import { SwfBridge, layer as SwfBridgeLayer } from "./SwfBridge";

describe("SwfBridge", () => {
  it.effect("returns generated fallbacks and logs bridge failures", () =>
    Effect.gen(function* () {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const bridge = yield* SwfBridge.pipe(Effect.provide(SwfBridgeLayer));

      expect(yield* bridge.call("bank.getSlots")).toBe(0);
      expect(warn).toHaveBeenCalledWith(
        "[flash:bridge]",
        "call failed; using fallback",
        expect.objectContaining({ method: "bank.getSlots" }),
      );

      warn.mockRestore();
    }),
  );
});
