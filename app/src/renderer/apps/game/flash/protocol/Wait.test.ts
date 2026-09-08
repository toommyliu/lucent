import { describe, expect, expectTypeOf, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as PubSub from "effect/PubSub";
import * as TestClock from "effect/testing/TestClock";

import type { Event, ProjectionEvent } from "../contract/Event";
import type { ExtensionPacket, Packet } from "../contract/Packet";
import { makeWait } from "./Wait";

describe("Wait", () => {
  it.effect("subscribes before its trigger and cleans up on timeout", () =>
    Effect.gen(function* () {
      const events = yield* PubSub.unbounded<Event>();
      const packets = yield* PubSub.unbounded<Packet>();
      let activeSubscriptions = 0;
      const track = <A>(pubsub: PubSub.PubSub<A>) =>
        Effect.gen(function* () {
          const subscription = yield* PubSub.subscribe(pubsub);
          activeSubscriptions += 1;
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              activeSubscriptions -= 1;
            }),
          );
          return subscription;
        });
      const wait = makeWait({
        subscribeEvents: track(events),
        subscribePackets: track(packets),
      });
      const packet: Packet = {
        command: "ccqr",
        data: {},
        direction: "extension",
        raw: "",
        encoding: "json",
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
      expect(activeSubscriptions).toBe(0);

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
      expect(activeSubscriptions).toBe(0);

      const observedLogin = yield* wait.forProjectionEvent(
        { type: "login" },
        {
          timeout: "1 second",
          trigger: Effect.gen(function* () {
            yield* PubSub.publish(events, connection);
            yield* PubSub.publish(events, { type: "login" });
            return true;
          }),
        },
      );
      expectTypeOf(observedLogin).toEqualTypeOf<Extract<
        ProjectionEvent,
        { readonly type: "login" }
      > | null>();
      expect(observedLogin).toEqual({ type: "login" });
      expect(activeSubscriptions).toBe(0);

      const skipped = yield* wait.forPacket(undefined, {
        timeout: "1 hour",
        trigger: Effect.succeed(false),
      });
      expect(skipped).toBeNull();
      expect(activeSubscriptions).toBe(0);

      const timeoutFiber = yield* wait
        .forEvent(undefined, { timeout: "1 second" })
        .pipe(Effect.forkScoped);
      yield* Effect.yieldNow;
      expect(activeSubscriptions).toBe(1);
      yield* TestClock.adjust("1 second");
      expect(yield* Fiber.join(timeoutFiber)).toBeNull();
      expect(activeSubscriptions).toBe(0);
    }),
  );
});
