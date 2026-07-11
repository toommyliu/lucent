import { Effect, Option, Schema } from "effect";

import {
  PositiveWireInt,
  UnknownRecord,
  WireBoolean,
} from "../contract/Coercion";
import type { Event } from "../contract/Event";
import {
  ignoreDiagnostic,
  type DiagnosticReporter,
} from "../contract/Diagnostic";
import { packetData, type Packet } from "../contract/Packet";
import { QuestPayload, toQuest } from "../contract/payload/Quests";
import type { Store } from "../state/Store";

const QuestList = Schema.Struct({ quests: UnknownRecord });
const QuestComplete = Schema.Struct({
  QuestID: Schema.optionalKey(PositiveWireInt),
  bSuccess: WireBoolean,
});
const decodeQuestList = Schema.decodeUnknownOption(QuestList);
const decodeQuest = Schema.decodeUnknownOption(QuestPayload);
const decodeComplete = Schema.decodeUnknownOption(QuestComplete);

export const projectQuests = (
  store: Store,
  packet: Packet,
  diagnose: DiagnosticReporter = ignoreDiagnostic,
): Effect.Effect<readonly Event[]> =>
  Effect.gen(function* () {
    if (packet.command === "getQuests" || packet.command === "getQuests2") {
      const list = decodeQuestList(packetData(packet));
      if (Option.isNone(list)) {
        yield* diagnose(
          `quests:${packet.command}`,
          new Error("Malformed quest payload"),
          ["[payload omitted]"],
        );
        return [];
      }
      for (const [rawId, rawQuest] of Object.entries(list.value.quests)) {
        const id = Number(rawId);
        const quest = decodeQuest(rawQuest);
        if (Number.isInteger(id) && id > 0 && Option.isSome(quest)) {
          yield* store.quests.upsert(toQuest(id, quest.value));
        }
      }
      return [];
    }

    if (packet.command !== "ccqr") return [];
    const complete = decodeComplete(packetData(packet));
    if (Option.isNone(complete)) {
      yield* diagnose(
        "quests:ccqr",
        new Error("Malformed quest completion payload"),
        ["[payload omitted]"],
      );
    }
    return Option.isSome(complete) && complete.value.bSuccess
      ? [
          {
            type: "quest-complete",
            questId: complete.value.QuestID ?? 0,
          },
        ]
      : [];
  });
