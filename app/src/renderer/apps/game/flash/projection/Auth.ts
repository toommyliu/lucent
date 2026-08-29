import * as Effect from "effect/Effect";

import type { Event, RuntimeEvent } from "../contract/Event";
import type { Store } from "../state/Store";

// Connection callbacks start a projection epoch; loss and failure also
// invalidate the authenticated state.
const lostConnections = new Set(["OnConnectionLost", "OnConnectionFailed"]);
const resetConnections = new Set([...lostConnections, "OnConnection"]);

export const projectAuth = (
  store: Store,
  event: RuntimeEvent,
): Effect.Effect<readonly Event[]> => {
  return event.type === "connection" && resetConnections.has(event.status)
    ? Effect.all(
        [
          ...(lostConnections.has(event.status)
            ? [store.auth.setLoggedIn(false)]
            : []),
          store.items.clear,
          store.projection.reset,
          store.quests.clear,
          store.shops.clear,
          store.world.clearArea,
          store.world.clearSelf,
        ],
        { discard: true },
      ).pipe(Effect.as([]))
    : Effect.succeed([]);
};
