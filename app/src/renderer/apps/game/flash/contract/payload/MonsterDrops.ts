import { getItemRarityName, type MonsterDrop } from "@lucent/game";
import * as Schema from "effect/Schema";

import { PositiveWireInt, WireBoolean, WireInt, WireNumber } from "../Coercion";
import { ItemFields, toItem } from "./Items";

export const MonsterDropItemPayload = Schema.Struct({
  ...ItemFields,
  bEventDrop: Schema.optionalKey(WireBoolean),
  bQuestGated: Schema.optionalKey(WireBoolean),
  bVaryQty: Schema.optionalKey(WireBoolean),
  iRate: Schema.optionalKey(WireNumber),
  iRateBoosted: Schema.optionalKey(WireNumber),
  iRty: Schema.optionalKey(WireInt),
  iStk: Schema.optionalKey(WireInt),
  questGated: Schema.optionalKey(Schema.Array(Schema.String)),
  questObjective: Schema.optionalKey(Schema.Array(Schema.String)),
  sIcon: Schema.optionalKey(Schema.String),
  sReqQuests: Schema.optionalKey(Schema.String),
});
export type MonsterDropItemPayload = typeof MonsterDropItemPayload.Type;

export const MonsterDropsPayload = Schema.Struct({
  MonMapID: PositiveWireInt,
  items: Schema.Record(Schema.String, Schema.Unknown),
});
export type MonsterDropsPayload = typeof MonsterDropsPayload.Type;

export const decodeMonsterDropItem = Schema.decodeUnknownOption(
  MonsterDropItemPayload,
);
export const decodeMonsterDrops =
  Schema.decodeUnknownOption(MonsterDropsPayload);

const displayedRate = (
  rate: number | undefined,
  divisor: number,
): number | null =>
  rate === undefined ? null : Math.min(100, rate / Math.max(1, divisor));

const parseRequiredQuestIds = (value: string | undefined): readonly number[] =>
  Array.from(
    new Set(
      (value ?? "")
        .split(",")
        .map((part) => Number(part.trim()))
        .filter((id) => Number.isSafeInteger(id) && id > 0),
    ),
  );

/** Converts the wire item to the same values AQW's monster-drop UI displays. */
export const toMonsterDrop = (payload: MonsterDropItemPayload): MonsterDrop => {
  const item = toItem(payload, { context: "monster-drop" }).toJSON();
  const variableQuantity = payload.bVaryQty ?? false;
  const rateDivisor = variableQuantity ? item.quantity : 1;
  const rarity = payload.iRty ?? 0;
  const requiredQuests = payload.questGated ?? [];

  return {
    eventDrop: payload.bEventDrop ?? false,
    icon: payload.sIcon ?? "",
    item,
    questGated: (payload.bQuestGated ?? false) || requiredQuests.length > 0,
    questObjectives: [...(payload.questObjective ?? [])],
    rarity,
    rarityName: getItemRarityName(rarity),
    rateBoostPercent: displayedRate(payload.iRateBoosted, rateDivisor),
    ratePercent: displayedRate(payload.iRate, rateDivisor),
    requiredQuestIds: parseRequiredQuestIds(payload.sReqQuests),
    requiredQuests: [...requiredQuests],
    stackSize: Math.max(1, payload.iStk ?? 1),
    variableQuantity,
  };
};
