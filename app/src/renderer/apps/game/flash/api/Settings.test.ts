import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";

import { makeBridge } from "../bridge/Bridge";
import { makeStore } from "../state/Store";
import { makeSettings } from "./Settings";

describe("Settings", () => {
  it.effect("serializes user changes with recurring reapplication", () =>
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
      const applying = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const settings = yield* makeSettings(
        {
          ...bridge,
          invoke: (method, args, schema) =>
            Effect.gen(function* () {
              if (
                method === "settings.setAnimationsEnabled" &&
                args?.[0] === true
              ) {
                yield* Deferred.succeed(applying, undefined);
                yield* Deferred.await(release);
              }
              return yield* bridge.invoke(method, args, schema);
            }),
        },
        store,
      );

      const reapply = yield* settings.reapply().pipe(Effect.forkScoped);
      yield* Deferred.await(applying);
      const update = yield* settings
        .setAnimationsEnabled(false)
        .pipe(Effect.forkScoped);
      yield* Effect.yieldNow;
      expect(update.pollUnsafe()).toBeUndefined();
      expect(appliedAnimations).toEqual([]);
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(reapply);
      yield* Fiber.join(update);
      expect(appliedAnimations).toEqual([true, false]);

      expect((yield* settings.get()).animationsEnabled).toBe(false);
      expect(appliedAnimations.at(-1)).toBe(false);
    }),
  );
});
