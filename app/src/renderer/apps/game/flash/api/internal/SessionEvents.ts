import * as Effect from "effect/Effect";
import * as FiberMap from "effect/FiberMap";
import * as Ref from "effect/Ref";
import * as Semaphore from "effect/Semaphore";

import type { ProjectionEvent, RuntimeEvent } from "../../contract/Event";

const readinessKey = "player-ready";

export const makeSessionEvents = Effect.fn("makeSessionEvents")(function* (
  awaitPlayerReady: Effect.Effect<void>,
  publishEvent: (event: ProjectionEvent) => Effect.Effect<void>,
) {
  const fibers = yield* FiberMap.make<string>();
  const lifecycle = yield* Semaphore.make(1);
  const loggedIn = yield* Ref.make(false);

  const clearSession = lifecycle.withPermits(1)(Ref.set(loggedIn, false));
  const publishLogin = lifecycle.withPermits(1)(
    Effect.gen(function* () {
      if (yield* Ref.get(loggedIn)) return;
      yield* publishEvent({ type: "login" });
      yield* Ref.set(loggedIn, true);
    }).pipe(Effect.uninterruptible),
  );
  const publishLogout = lifecycle.withPermits(1)(
    Effect.gen(function* () {
      if (!(yield* Ref.getAndSet(loggedIn, false))) return;
      yield* publishEvent({ type: "logout" });
    }).pipe(Effect.uninterruptible),
  );

  const cancelReadiness = FiberMap.remove(fibers, readinessKey);

  const handleRuntimeEvent = Effect.fn("SessionEvents.handleRuntimeEvent")(
    function* (event: RuntimeEvent) {
      if (event.type !== "connection") return;

      switch (event.status) {
        case "OnConnection":
          yield* cancelReadiness;
          yield* clearSession;
          // The transport connects before the player is authenticated and usable.
          yield* FiberMap.run(
            fibers,
            readinessKey,
            awaitPlayerReady.pipe(Effect.andThen(publishLogin)),
          );
          return;
        case "OnConnectionFailed":
          yield* cancelReadiness;
          yield* clearSession;
          return;
        case "OnConnectionLost":
          yield* cancelReadiness;
          yield* publishLogout;
          return;
      }
    },
  );

  return { handleRuntimeEvent };
});

export type SessionEvents = Effect.Success<
  ReturnType<typeof makeSessionEvents>
>;
