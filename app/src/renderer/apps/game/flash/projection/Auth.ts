import { Effect } from "effect";

import type { RuntimeEvent } from "../contract/Event";
import type { Store } from "../state/Store";

// A new connection begins a projection epoch, but only loss or failure proves
// that an authenticated session ended.
const lostConnections = new Set(["OnConnectionLost", "OnConnectionFailed"]);
const resetConnections = new Set([...lostConnections, "OnConnection"]);

export const projectAuth = (store: Store, event: RuntimeEvent) =>
  event.type === "connection" && resetConnections.has(event.status)
    ? Effect.all(
        [
          ...(lostConnections.has(event.status)
            ? [store.auth.setLoggedIn(false)]
            : []),
          store.items.clear,
          store.quests.clear,
          store.shops.clear,
          store.world.clearArea,
          store.world.clearSelf,
        ],
        { discard: true },
      )
    : Effect.void;
