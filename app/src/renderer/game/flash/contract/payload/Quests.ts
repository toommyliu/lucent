import { LiveQuest } from "@lucent/game";
import type { QuestCadence, QuestItem, QuestReward } from "@lucent/game";
import { Option, Schema } from "effect";

import {
  PositiveWireInt,
  UnknownArray,
  UnknownRecord,
  WireBoolean,
  WireInt,
  WireNumber,
} from "../Coercion";

export const QuestItemPayload = Schema.Struct({
  DropChance: Schema.optionalKey(WireNumber),
  ItemID: PositiveWireInt,
  iQty: Schema.optionalKey(WireInt),
  iRate: Schema.optionalKey(WireNumber),
  sName: Schema.optionalKey(Schema.String),
});
export type QuestItemPayload = typeof QuestItemPayload.Type;

export const QuestPayload = Schema.Struct({
  QuestID: Schema.optionalKey(PositiveWireInt),
  Rewards: Schema.optionalKey(Schema.Array(Schema.Unknown)),
  Rewards2: Schema.optionalKey(Schema.Array(Schema.Unknown)),
  RequiredItems: Schema.optionalKey(Schema.Array(Schema.Unknown)),
  bOnce: Schema.optionalKey(WireBoolean),
  oItems: Schema.optionalKey(UnknownRecord),
  oReqd: Schema.optionalKey(UnknownRecord),
  oRewards: Schema.optionalKey(UnknownRecord),
  reward: Schema.optionalKey(Schema.Array(Schema.Unknown)),
  sField: Schema.optionalKey(Schema.String),
  sName: Schema.optionalKey(Schema.String),
  turnin: Schema.optionalKey(Schema.Array(Schema.Unknown)),
});
export type QuestPayload = typeof QuestPayload.Type;

const decodeQuestItem = Schema.decodeUnknownOption(QuestItemPayload);
const decodeArray = Schema.decodeUnknownOption(UnknownArray);
const decodeRecord = Schema.decodeUnknownOption(UnknownRecord);

const collectQuestItems = (value: unknown): readonly QuestItemPayload[] => {
  const item = decodeQuestItem(value);
  if (Option.isSome(item)) return [item.value];

  const array = decodeArray(value);
  if (Option.isSome(array)) return array.value.flatMap(collectQuestItems);

  const record = decodeRecord(value);
  return Option.isSome(record)
    ? Object.values(record.value).flatMap(collectQuestItems)
    : [];
};

const indexedItems = (
  values: readonly unknown[],
): ReadonlyMap<number, QuestItemPayload> => {
  const items = new Map<number, QuestItemPayload>();
  for (const value of values.flatMap(collectQuestItems)) {
    items.set(value.ItemID, value);
  }
  return items;
};

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

const toQuestItem = (
  payload: QuestItemPayload,
  quantityOverride?: number,
): QuestItem => ({
  itemId: payload.ItemID,
  name: payload.sName ?? `Item ${payload.ItemID}`,
  quantity: Math.max(1, quantityOverride ?? payload.iQty ?? 1),
});

const toReward = (
  payload: QuestItemPayload,
  rateOverride?: number,
): QuestReward => ({
  ...toQuestItem(payload),
  ...((rateOverride ?? payload.DropChance ?? payload.iRate) === undefined
    ? {}
    : { dropChance: rateOverride ?? payload.DropChance ?? payload.iRate }),
});

export const toQuest = (id: number, payload: QuestPayload): LiveQuest => {
  const turnIn = indexedItems(payload.turnin ?? []);
  const rewardRates = indexedItems(payload.reward ?? []);
  const requirements = indexedItems([
    ...(payload.RequiredItems ?? []),
    payload.oItems ?? payload.oReqd ?? {},
  ]);
  const rewards = indexedItems([
    ...(payload.Rewards ?? payload.Rewards2 ?? []),
    payload.oRewards ?? {},
  ]);

  return new LiveQuest({
    cadence: cadence(payload.sField),
    id,
    name: payload.sName ?? `Quest ${id}`,
    once: payload.bOnce ?? false,
    requirements: Array.from(requirements.values()).map((item) =>
      toQuestItem(item, turnIn.get(item.ItemID)?.iQty),
    ),
    rewards: Array.from(rewards.values()).map((item) =>
      toReward(item, rewardRates.get(item.ItemID)?.iRate),
    ),
  });
};
