import { Effect } from "effect";

import type { FlashPacket, FlashProjectionEvent } from "../../Types";
import { asBoolean, asRecord } from "../../payload";
import type { QuestsStateShape } from "../../state/Quests";
import { packetData } from "../ProjectorDecoders";

export const projectQuestPacket = (
  packet: FlashPacket,
  quests: QuestsStateShape,
): Effect.Effect<readonly FlashProjectionEvent[]> =>
  Effect.gen(function* () {
    const payload = packetData(packet);
    switch (packet.command) {
      case "getQuests":
      case "getQuests2":
        yield* quests.reduceGetQuests(payload);
        return [];
      case "ccqr": {
        const record = asRecord(payload);
        return record !== null && asBoolean(record["bSuccess"]) === true
          ? [
              {
                kind: "projection",
                packet,
                payload: record,
                type: "questComplete",
              },
            ]
          : [];
      }
      default:
        return [];
    }
  });
