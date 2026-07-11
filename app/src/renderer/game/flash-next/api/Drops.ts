import { Effect, Option, Schema } from "effect";

import type { BridgeService } from "../bridge/Bridge";
import { decodeItemSelector } from "../domain/Selectors";
import type { Store } from "../state/Store";
import type { Wait } from "./Wait";

export const makeDrops = (bridge: BridgeService, store: Store, wait: Wait) => ({
  accept: (selector: unknown) => {
    const decoded = decodeItemSelector(selector);
    if (Option.isNone(decoded)) return Effect.succeed(false);
    return store.items.get("drop", decoded.value).pipe(
      Effect.flatMap((drop) =>
        drop === null
          ? Effect.succeed(false)
          : wait
              .forPacket(
                { command: "getDrop", direction: "extension" },
                {
                  timeout: "10 seconds",
                  trigger: bridge.invoke(
                    "drops.acceptDrop",
                    [drop.itemId],
                    Schema.Boolean,
                  ),
                },
              )
              .pipe(Effect.map((packet) => packet !== null)),
      ),
    );
  },
  contains: (selector: unknown) => {
    const decoded = decodeItemSelector(selector);
    return Option.isNone(decoded)
      ? Effect.succeed(false)
      : store.items
          .get("drop", decoded.value)
          .pipe(Effect.map((drop) => drop !== null));
  },
  getAll: () => store.items.getAll("drop"),
  isCustomUiEnabled: () =>
    bridge
      .invoke("drops.isUsingCustomDrops", undefined, Schema.Boolean)
      .pipe(Effect.map(Option.getOrElse(() => false))),
  reject: (selector: unknown) => {
    const decoded = decodeItemSelector(selector);
    if (Option.isNone(decoded)) return Effect.succeed(false);
    return store.items.get("drop", decoded.value).pipe(
      Effect.flatMap((drop) =>
        drop === null
          ? Effect.succeed(false)
          : bridge.invoke("drops.rejectDrop", [drop.itemId], Schema.Void).pipe(
              Effect.flatMap(
                Option.match({
                  onNone: () => Effect.succeed(false),
                  onSome: () =>
                    store.items
                      .remove("drop", drop.itemId)
                      .pipe(Effect.as(true)),
                }),
              ),
            ),
      ),
    );
  },
  toggleUi: () =>
    bridge.invoke("drops.toggleUi", undefined, Schema.Void).pipe(Effect.asVoid),
});

export type Drops = ReturnType<typeof makeDrops>;
