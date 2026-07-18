import { Effect } from "effect";

import type { RuntimeEvent } from "../contract/Event";
import type { Store } from "../state/Store";

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
          store.world.clearArea,
          store.world.clearSelf,
        ],
        { discard: true },
      )
    : Effect.void;
