import { Effect, Option, Schema } from "effect";

import type { Event } from "../contract/Event";
import {
  ignoreDiagnostic,
  type DiagnosticReporter,
} from "../contract/Diagnostic";
import { packetData, type Packet } from "../contract/Packet";
import { ShopPayload, toShop } from "../contract/payload/Shops";
import { toItem } from "../contract/payload/Items";
import type { Store } from "../state/Store";

const WrappedShop = Schema.Struct({ shopinfo: ShopPayload });
const decodeShop = Schema.decodeUnknownOption(
  Schema.Union([ShopPayload, WrappedShop]),
);

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
        "[payload omitted]",
      ]);
      return [];
    }
    const payload =
      "shopinfo" in decoded.value ? decoded.value.shopinfo : decoded.value;
    const shop = toShop(payload);
    yield* store.shops.set(shop);
    yield* store.items.replace(
      "shop",
      (payload.items ?? []).map((item) => toItem(item, { context: "shop" })),
    );
    return [];
  });
