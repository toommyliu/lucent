import { Effect } from "effect";

import type { FlashPacket, FlashProjectionEvent } from "../../Types";
import type { ShopsStateShape } from "../../state/Shops";
import { packetData } from "../ProjectorDecoders";

export const projectShopPacket = (
  packet: FlashPacket,
  shops: ShopsStateShape,
): Effect.Effect<readonly FlashProjectionEvent[]> =>
  packet.command === "loadShop"
    ? shops.setInfo(packetData(packet)).pipe(Effect.as([]))
    : Effect.succeed([]);
