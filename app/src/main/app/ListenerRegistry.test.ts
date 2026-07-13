import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { makeListenerRegistry } from "./ListenerRegistry";

describe("ListenerRegistry", () => {
  it.effect("isolates listener failures and continues publishing", () =>
    Effect.gen(function* () {
      const registry = makeListenerRegistry<number>();
      const received: number[] = [];

      yield* registry.subscribe(() => {
        throw new Error("listener failed");
      });
      yield* registry.subscribe((value) => {
        received.push(value);
      });

      yield* registry.publish(42);

      expect(received).toEqual([42]);
    }),
  );

  it.effect("stops publishing to unsubscribed listeners", () =>
    Effect.gen(function* () {
      const registry = makeListenerRegistry<number>();
      const received: number[] = [];
      const unsubscribe = yield* registry.subscribe((value) => {
        received.push(value);
      });

      yield* registry.publish(1);
      unsubscribe();
      yield* registry.publish(2);

      expect(received).toEqual([1]);
    }),
  );
});
