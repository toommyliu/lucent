import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FiberMap from "effect/FiberMap";
import * as Ref from "effect/Ref";
import * as TestClock from "effect/testing/TestClock";

import type { ApiService } from "../flash/api/Api";
import type { Event, EventSelector } from "../flash/contract/Event";
import { makeAutoZone } from "./AutoZone";

describe("AutoZone", () => {
  it.effect("interrupts an obsolete delayed transition", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const positions = yield* Ref.make<readonly { x: number; y: number }[]>(
          [],
        );
        const fibers = yield* FiberMap.make<string>();
        let handleEvent: ((event: Event) => Effect.Effect<void>) | undefined;
        const api = {
          events: {
            on: (
              _selector: EventSelector | undefined,
              handler: (event: Event) => Effect.Effect<void>,
            ) => {
              handleEvent = handler;
              return Effect.succeed(() => undefined);
            },
          },
          map: { getName: () => Effect.succeed("queeniona") },
          player: {
            auras: { get: () => Effect.succeed({}) },
            walkTo: (x: number, y: number) =>
              Ref.update(positions, (current) => [...current, { x, y }]).pipe(
                Effect.as(true),
              ),
          },
        } as unknown as ApiService;
        const autoZone = yield* makeAutoZone(api, fibers);

        yield* autoZone.setMap("queeniona");
        yield* autoZone.setEnabled(true);
        yield* handleEvent!({ type: "zone", map: "queeniona", zone: "A" });
        yield* handleEvent!({ type: "zone", map: "queeniona", zone: "B" });
        yield* TestClock.adjust("500 millis");
        yield* Effect.yieldNow;

        const moved = yield* Ref.get(positions);
        expect(moved).toHaveLength(1);
        expect(moved[0]!.x).toBeGreaterThanOrEqual(111);
        expect(moved[0]!.x).toBeLessThanOrEqual(272);
      }),
    ).pipe(Effect.provide(TestClock.layer())),
  );
});
