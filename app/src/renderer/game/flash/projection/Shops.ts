import { Effect, Option, Schema } from "effect";
import type { LiveItem } from "@lucent/game";

import type { Event } from "../contract/Event";
import {
  ignoreDiagnostic,
  type DiagnosticReporter,
} from "../contract/Diagnostic";
import { packetData, type Packet } from "../contract/Packet";
import { ShopPayload, toShop } from "../contract/payload/Shops";
import { ItemPayload, toItem } from "../contract/payload/Items";
import type { Store } from "../state/Store";

const WrappedShop = Schema.Struct({ shopinfo: ShopPayload });
const decodeShop = Schema.decodeUnknownOption(
  Schema.Union([ShopPayload, WrappedShop]),
);
const decodeItem = Schema.decodeUnknownOption(ItemPayload);

export const projectShops = (
  store: Store,
  packet: Packet,
  diagnose: DiagnosticReporter = ignoreDiagnostic,
): Effect.Effect<readonly Event[]> =>
  Effect.gen(function* () {
    if (packet.command !== "loadShop") return [];
    const decoded = decodeShop(packetData(packet));
    if (Option.isNone(decoded)) {
      yield* diagnose("shops:loadShop", new Error("Malformed shop payload"), [
        packetData(packet),
      ]);
      return [];
    }
    const payload =
      "shopinfo" in decoded.value ? decoded.value.shopinfo : decoded.value;
    const items: LiveItem[] = [];
    const invalidItems: unknown[] = [];
    for (const value of payload.items ?? []) {
      const item = decodeItem(value);
      if (Option.isSome(item)) {
        items.push(toItem(item.value, { context: "shop" }));
      } else {
        invalidItems.push(value);
      }
    }
    if (invalidItems.length > 0) {
      yield* diagnose(
        "shops:loadShop:entries",
        new Error(`Ignored ${invalidItems.length} malformed shop items`),
        invalidItems,
      );
    }
    const shop = toShop(payload, items);
    yield* store.shops.set(shop);
    yield* store.items.replace("shop", items);
    return [];
  });
