import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type { LiveItem } from "@lucent/game";

import type { Event } from "../contract/Event";
import {
  ignoreDiagnostic,
  type DiagnosticReporter,
} from "../contract/Diagnostic";
import type { ExtensionPacket } from "../contract/Packet";
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
  packet: ExtensionPacket,
  diagnose: DiagnosticReporter = ignoreDiagnostic,
): Effect.Effect<readonly Event[]> =>
  Effect.gen(function* () {
    if (packet.command !== "loadShop") return [];
    const decoded = decodeShop(packet.data);
    if (Option.isNone(decoded)) {
      yield* diagnose("shops:loadShop", new Error("Malformed shop payload"), [
        packet.data,
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
