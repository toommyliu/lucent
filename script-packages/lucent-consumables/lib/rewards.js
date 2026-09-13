// @ts-check

const s = require("lucent/schema");

const packetSchema = s.object({
  items: s.union([s.record(s.unknown()), s.array(s.unknown())]),
});
const itemSchema = s.object({
  ItemID: s.unknown().optional(),
  iQty: s.coerce.number().gt(0),
  sName: s.string().nullable().catch(null),
});
const itemIdSchema = s.coerce.number().int().min(1);

/** Collects valid rewards independently because one malformed entry must not hide another.
 * @param {unknown} data
 * @param {Map<number, string | null>} rewards */
function collectRewards(data, rewards) {
  const packet = packetSchema.safeParse(data);
  if (!packet.success) return;
  for (const [key, value] of Object.entries(packet.data.items)) {
    const item = itemSchema.safeParse(value);
    if (!item.success) continue;
    const id = itemIdSchema.safeParse(item.data.ItemID ?? key);
    if (id.success) rewards.set(id.data, item.data.sName);
  }
}

module.exports = { collectRewards };
