import { TrimmedNonEmptyString } from "@lucent/core";
import { Schema, SchemaTransformation } from "effect";

export const EnhancementSelectorSchema = Schema.Struct({
  enhancement: TrimmedNonEmptyString,
  special: Schema.optionalKey(TrimmedNonEmptyString),
});

const enhancementSlots = ["cape", "class", "helm", "weapon"] as const;
type EnhancementSlot = (typeof enhancementSlots)[number];

const EnhancementSlotSchema = TrimmedNonEmptyString.pipe(
  Schema.decodeTo(
    Schema.Literals(enhancementSlots),
    SchemaTransformation.transform<EnhancementSlot, string>({
      decode: (value) => value.toLowerCase() as EnhancementSlot,
      encode: (value) => value,
    }),
  ),
);

export const EquipEnhancementSelectorSchema = Schema.Struct({
  ...EnhancementSelectorSchema.fields,
  slot: Schema.optionalKey(EnhancementSlotSchema),
});

export type EquipEnhancementSelector =
  typeof EquipEnhancementSelectorSchema.Type;
