// @ts-check

const s = require("lucent/schema");

const rewardSchema = s.object({ sName: s.string().min(1) });
const packetSchema = s.object({
  direction: s.literal("extension"),
  data: s.object({
    dropItems: s.record(s.unknown()).catch({}),
    Item: s.unknown().optional(),
  }),
});

/** @param {unknown} value */
const rewardName = (value) =>
  rewardSchema.is(value) ? value.sName : undefined;

/** Reads each reward independently, including the optional wheel prize.
 * @param {unknown} packet
 * @param {number} boostItemId */
function wheelRewardNames(packet, boostItemId) {
  const result = packetSchema.safeParse(packet);
  if (!result.success) return [];
  const { dropItems, Item } = result.data.data;
  const names = [rewardName(dropItems[String(boostItemId)]), rewardName(Item)];
  return [...new Set(names.filter((name) => name !== undefined))];
}

module.exports = { wheelRewardNames };
