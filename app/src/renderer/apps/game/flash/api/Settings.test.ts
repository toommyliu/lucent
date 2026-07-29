import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { makeBridge } from "../bridge/Bridge";
import { makeStore } from "../state/Store";
import { makeSettings } from "./Settings";

describe("Settings", () => {
  it.effect("serializes user changes with recurring reapplication", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const appliedAnimations: boolean[] = [];
        const target = {
          swf: {
            "settings.setAnimationsEnabled": (enabled: boolean) => {
              appliedAnimations.push(enabled);
            },
            "settings.setCollisionsEnabled": () => undefined,
            "settings.setDeathAdsVisible": () => undefined,
            "settings.setFrameRate": () => undefined,
            "settings.setLagKillerEnabled": () => undefined,
            "settings.setOtherPlayersVisible": () => undefined,
            "settings.setWalkSpeed": () => undefined,
          },
        } as unknown as Window;
        const bridge = yield* makeBridge(target);
        const store = yield* makeStore;
        const settings = yield* makeSettings(bridge, store);

        yield* Effect.all(
          [settings.reapply(), settings.setAnimationsEnabled(false)],
          { concurrency: "unbounded" },
        );

        expect((yield* settings.get()).animationsEnabled).toBe(false);
        expect(appliedAnimations.at(-1)).toBe(false);
      }),
    ),
  );
});
