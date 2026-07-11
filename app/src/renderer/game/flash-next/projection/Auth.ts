import { Effect } from "effect";

import type { RuntimeEvent } from "../contract/Event";
import type { Store } from "../state/Store";

const lostConnections = new Set(["OnConnectionLost", "OnConnectionFailed"]);

export const projectAuth = (store: Store, event: RuntimeEvent) =>
  event.type === "connection" && lostConnections.has(event.status)
    ? store.auth.setLoggedIn(false)
    : Effect.void;
