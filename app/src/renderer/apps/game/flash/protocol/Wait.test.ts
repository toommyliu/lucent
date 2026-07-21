import { describe, expect, expectTypeOf, it } from "@effect/vitest";
import { Effect, Fiber, PubSub } from "effect";
import * as TestClock from "effect/testing/TestClock";

import type { Event } from "../contract/Event";
import type { ExtensionPacket, Packet } from "../contract/Packet";
import { makeWait } from "./Wait";

describe("Wait", () => {
  it.effect("subscribes before its trigger and cleans up on timeout", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const events = yield* PubSub.unbounded<Event>();
        const packets = yield* PubSub.unbounded<Packet>();
        const wait = makeWait({
          subscribeEvents: PubSub.subscribe(events),
          subscribePackets: PubSub.subscribe(packets),
        });
        const packet: Packet = {
          command: "ccqr",
          data: {},
          direction: "extension",
          raw: "",
          wireType: "json",
        };

        const observed = yield* wait.forPacket(
          { command: "ccqr", direction: "extension" },
          {
            timeout: "1 second",
            trigger: PubSub.publish(packets, packet),
          },
        );
        expectTypeOf(observed).toEqualTypeOf<ExtensionPacket | null>();
        expect(observed).toEqual(packet);

        const connection: Event = {
          status: "OnConnection",
          type: "connection",
        };
        const observedConnection = yield* wait.forEvent(
          { type: "connection" },
          {
            timeout: "1 second",
            trigger: PubSub.publish(events, connection),
          },
        );
        expectTypeOf(observedConnection).toEqualTypeOf<Extract<
          Event,
          { readonly type: "connection" }
        > | null>();
        expect(observedConnection).toEqual(connection);

        const skipped = yield* wait.forPacket(undefined, {
          timeout: "1 hour",
          trigger: Effect.succeed(false),
        });
        expect(skipped).toBeNull();

        const timeoutFiber = yield* wait
          .forEvent(undefined, { timeout: "1 second" })
          .pipe(Effect.forkScoped);
        yield* Effect.yieldNow;
        yield* TestClock.adjust("1 second");
        expect(yield* Fiber.join(timeoutFiber)).toBeNull();
      }),
    ).pipe(Effect.provide(TestClock.layer())),
  );
});
