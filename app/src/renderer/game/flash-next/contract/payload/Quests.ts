import { LiveQuest } from "@lucent/game";
import type { QuestCadence, QuestItem, QuestReward } from "@lucent/game";
import { Schema } from "effect";

import { PositiveWireInt, WireBoolean, WireInt, WireNumber } from "../Coercion";

export const QuestItemPayload = Schema.Struct({
  DropChance: Schema.optionalKey(WireNumber),
  ItemID: PositiveWireInt,
  iQty: Schema.optionalKey(WireInt),
  iRate: Schema.optionalKey(WireNumber),
  sName: Schema.optionalKey(Schema.String),
});
export type QuestItemPayload = typeof QuestItemPayload.Type;

export const QuestPayload = Schema.Struct({
  Rewards: Schema.optionalKey(Schema.Array(QuestItemPayload)),
  Rewards2: Schema.optionalKey(Schema.Array(QuestItemPayload)),
  RequiredItems: Schema.optionalKey(Schema.Array(QuestItemPayload)),
  bOnce: Schema.optionalKey(WireBoolean),
  sField: Schema.optionalKey(Schema.String),
  sName: Schema.optionalKey(Schema.String),
});
export type QuestPayload = typeof QuestPayload.Type;

const cadence = (field: string | undefined): QuestCadence => {
  switch (field) {
    case "id0":
      return "daily";
    case "iw0":
      return "weekly";
    case "im0":
      return "monthly";
    default:
      return "none";
  }
};

const toQuestItem = (payload: QuestItemPayload): QuestItem => ({
  itemId: payload.ItemID,
  name: payload.sName ?? `Item ${payload.ItemID}`,
  quantity: Math.max(1, payload.iQty ?? 1),
});

const toReward = (payload: QuestItemPayload): QuestReward => ({
  ...toQuestItem(payload),
  ...((payload.DropChance ?? payload.iRate) === undefined
    ? {}
    : { dropChance: payload.DropChance ?? payload.iRate }),
});

export const toQuest = (id: number, payload: QuestPayload): LiveQuest =>
  new LiveQuest({
    cadence: cadence(payload.sField),
    id,
    name: payload.sName ?? `Quest ${id}`,
    once: payload.bOnce ?? false,
    requirements: (payload.RequiredItems ?? []).map(toQuestItem),
    rewards: (payload.Rewards ?? payload.Rewards2 ?? []).map(toReward),
  });
