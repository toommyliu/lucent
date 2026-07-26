import { PositiveInt, TrimmedNonEmptyString } from "@lucent/core";
import type { ItemQuery } from "@lucent/game";
import { Effect, Option, Schema } from "effect";

import { EnhancementSelectorSchema } from "../../EnhancementSelectors";
import type { BridgeService } from "../../flash/bridge/Bridge";
import { enhanceItem } from "../recipes/EnhanceItem";
import type { ScriptRecipeDependencies } from "../recipes/Dependencies";
import { ensureLifeSteal, ensureScrollOfEnrage } from "../recipes/Supplies";
import { doWheelOfDoom } from "../recipes/WheelOfDoom";
import type { ScriptRuntimeServices } from "./Services";

const ScriptItemQuerySchema = Schema.Union([
  PositiveInt,
  TrimmedNonEmptyString,
  Schema.Struct({
    itemId: PositiveInt,
    name: Schema.optionalKey(Schema.Never),
  }),
  Schema.Struct({
    itemId: Schema.optionalKey(Schema.Never),
    name: TrimmedNonEmptyString,
  }),
]);

export const ScriptEnhanceItemOptionsSchema = EnhancementSelectorSchema;

export type ScriptEnhanceItemOptions =
  typeof ScriptEnhanceItemOptionsSchema.Type;

const ScriptEnhanceItemRequestSchema = Schema.Struct({
  item: ScriptItemQuerySchema,
  options: ScriptEnhanceItemOptionsSchema,
});

const decodeScriptEnhanceItemRequest = Schema.decodeUnknownOption(
  ScriptEnhanceItemRequestSchema,
);

export interface ScriptRecipesApi {
  readonly doWheelOfDoom: (toBank?: boolean) => Effect.Effect<boolean>;
  readonly enhanceItem: (
    item: ItemQuery,
    options: ScriptEnhanceItemOptions,
  ) => Effect.Effect<boolean>;
  readonly ensureLifeSteal: (quantity: number) => Effect.Effect<boolean>;
  readonly ensureScrollOfEnrage: (quantity: number) => Effect.Effect<boolean>;
}

export const makeScriptRecipesApi = (
  services: ScriptRuntimeServices,
  bridge: BridgeService,
): ScriptRecipesApi => {
  const dependencies: ScriptRecipeDependencies = {
    bank: services.bank,
    bridge,
    drops: services.drops,
    inventory: services.inventory,
    player: services.player,
    quests: services.quests,
    shops: services.shops,
    wait: services.wait,
  };

  const recipes: ScriptRecipesApi = {
    doWheelOfDoom: (toBank) => doWheelOfDoom(dependencies, toBank),
    enhanceItem: (item, options) =>
      Option.match(decodeScriptEnhanceItemRequest({ item, options }), {
        onNone: () => Effect.succeed(false),
        onSome: (request) =>
          enhanceItem(dependencies, request.item, request.options),
      }),
    ensureLifeSteal: (quantity) => ensureLifeSteal(dependencies, quantity),
    ensureScrollOfEnrage: (quantity) =>
      ensureScrollOfEnrage(dependencies, quantity),
  };
  return Object.freeze(recipes);
};
