import {
  EnvironmentAutomationCapabilitySchema,
  EnvironmentItemRulesSchema,
  EnvironmentQuestAutoRegisterOptionsSchema,
  EnvironmentStateSchema,
} from "@lucent/core/environment";
import { PositiveInt } from "@lucent/core";
import * as Schema from "effect/Schema";

import { defineEvent, defineInvoke } from "./core";

const namespace = "desktop:environment";
export const EnvironmentBankBoostSchema = Schema.Struct({
  itemId: PositiveInt,
  name: Schema.String,
  quantity: PositiveInt,
});
export type EnvironmentBankBoost = typeof EnvironmentBankBoostSchema.Type;

export const EnvironmentBoostDiscoverySchema = Schema.Struct({
  bank: Schema.Array(EnvironmentBankBoostSchema),
  bankLoaded: Schema.Boolean,
  inventory: Schema.Array(Schema.String),
});
export type EnvironmentBoostDiscovery =
  typeof EnvironmentBoostDiscoverySchema.Type;

export const EnvironmentIpc = {
  getState: defineInvoke({
    channel: `${namespace}:get-state`,
    name: "environment.getState",
    payload: Schema.Void,
    result: EnvironmentStateSchema,
  }),
  clear: defineInvoke({
    channel: `${namespace}:clear`,
    name: "environment.clear",
    payload: Schema.Void,
    result: EnvironmentStateSchema,
  }),
  addQuest: defineInvoke({
    channel: `${namespace}:add-quest`,
    name: "environment.addQuest",
    payload: Schema.Struct({
      questId: PositiveInt,
      rewardItemId: Schema.optionalKey(PositiveInt),
    }),
    result: EnvironmentStateSchema,
  }),
  addQuests: defineInvoke({
    channel: `${namespace}:add-quests`,
    name: "environment.addQuests",
    payload: Schema.Struct({
      quests: Schema.Array(
        Schema.Struct({
          questId: PositiveInt,
          rewardItemId: Schema.optionalKey(PositiveInt),
        }),
      ),
    }),
    result: EnvironmentStateSchema,
  }),
  removeQuest: defineInvoke({
    channel: `${namespace}:remove-quest`,
    name: "environment.removeQuest",
    payload: Schema.Struct({
      questId: PositiveInt,
    }),
    result: EnvironmentStateSchema,
  }),
  setQuestReward: defineInvoke({
    channel: `${namespace}:set-quest-reward`,
    name: "environment.setQuestReward",
    payload: Schema.Struct({
      questId: PositiveInt,
      rewardItemId: PositiveInt,
    }),
    result: EnvironmentStateSchema,
  }),
  clearQuestReward: defineInvoke({
    channel: `${namespace}:clear-quest-reward`,
    name: "environment.clearQuestReward",
    payload: Schema.Struct({
      questId: PositiveInt,
    }),
    result: EnvironmentStateSchema,
  }),
  clearQuests: defineInvoke({
    channel: `${namespace}:clear-quests`,
    name: "environment.clearQuests",
    payload: Schema.Void,
    result: EnvironmentStateSchema,
  }),
  setQuestAutoRegister: defineInvoke({
    channel: `${namespace}:set-quest-auto-register`,
    name: "environment.setQuestAutoRegister",
    payload: EnvironmentQuestAutoRegisterOptionsSchema,
    result: EnvironmentStateSchema,
  }),
  setAutomationEnabled: defineInvoke({
    channel: `${namespace}:set-automation-enabled`,
    name: "environment.setAutomationEnabled",
    payload: Schema.Struct({
      capability: EnvironmentAutomationCapabilitySchema,
      enabled: Schema.Boolean,
    }),
    result: EnvironmentStateSchema,
  }),
  addItem: defineInvoke({
    channel: `${namespace}:add-item`,
    name: "environment.addItem",
    payload: Schema.Struct({
      name: Schema.String,
    }),
    result: EnvironmentStateSchema,
  }),
  addItems: defineInvoke({
    channel: `${namespace}:add-items`,
    name: "environment.addItems",
    payload: Schema.Struct({
      names: Schema.Array(Schema.String),
    }),
    result: EnvironmentStateSchema,
  }),
  removeItem: defineInvoke({
    channel: `${namespace}:remove-item`,
    name: "environment.removeItem",
    payload: Schema.Struct({
      name: Schema.String,
    }),
    result: EnvironmentStateSchema,
  }),
  setItemRules: defineInvoke({
    channel: `${namespace}:set-item-rules`,
    name: "environment.setItemRules",
    payload: EnvironmentItemRulesSchema,
    result: EnvironmentStateSchema,
  }),
  setItemNotification: defineInvoke({
    channel: `${namespace}:set-item-notification`,
    name: "environment.setItemNotification",
    payload: Schema.Struct({
      enabled: Schema.Boolean,
      name: Schema.String,
    }),
    result: EnvironmentStateSchema,
  }),
  clearItems: defineInvoke({
    channel: `${namespace}:clear-items`,
    name: "environment.clearItems",
    payload: Schema.Void,
    result: EnvironmentStateSchema,
  }),
  addBoost: defineInvoke({
    channel: `${namespace}:add-boost`,
    name: "environment.addBoost",
    payload: Schema.Struct({
      name: Schema.String,
    }),
    result: EnvironmentStateSchema,
  }),
  addBoosts: defineInvoke({
    channel: `${namespace}:add-boosts`,
    name: "environment.addBoosts",
    payload: Schema.Struct({
      names: Schema.Array(Schema.String),
    }),
    result: EnvironmentStateSchema,
  }),
  removeBoost: defineInvoke({
    channel: `${namespace}:remove-boost`,
    name: "environment.removeBoost",
    payload: Schema.Struct({
      name: Schema.String,
    }),
    result: EnvironmentStateSchema,
  }),
  clearBoosts: defineInvoke({
    channel: `${namespace}:clear-boosts`,
    name: "environment.clearBoosts",
    payload: Schema.Void,
    result: EnvironmentStateSchema,
  }),
  fetchBoosts: defineInvoke({
    channel: `${namespace}:fetch-boosts`,
    name: "environment.fetchBoosts",
    payload: Schema.Void,
    result: EnvironmentBoostDiscoverySchema,
  }),
  withdrawBoosts: defineInvoke({
    channel: `${namespace}:withdraw-boosts`,
    name: "environment.withdrawBoosts",
    payload: Schema.Struct({
      itemIds: Schema.Array(PositiveInt),
    }),
    result: Schema.Array(PositiveInt),
  }),
  syncToAll: defineInvoke({
    channel: `${namespace}:sync-to-all`,
    name: "environment.syncToAll",
    payload: Schema.Void,
    result: EnvironmentStateSchema,
  }),
  changed: defineEvent({
    channel: `${namespace}:changed`,
    name: "environment.changed",
    payload: EnvironmentStateSchema,
  }),
  fetchBoostsRequest: defineEvent({
    channel: `${namespace}:fetch-boosts-request`,
    name: "environment.fetchBoostsRequest",
    payload: Schema.Struct({
      requestId: Schema.String,
    }),
  }),
  fetchBoostsResponse: defineInvoke({
    channel: `${namespace}:fetch-boosts-response`,
    name: "environment.fetchBoostsResponse",
    payload: Schema.Struct({
      discovery: EnvironmentBoostDiscoverySchema,
      requestId: Schema.String,
    }),
    result: Schema.Void,
  }),
  withdrawBoostsRequest: defineEvent({
    channel: `${namespace}:withdraw-boosts-request`,
    name: "environment.withdrawBoostsRequest",
    payload: Schema.Struct({
      itemIds: Schema.Array(PositiveInt),
      requestId: Schema.String,
    }),
  }),
  withdrawBoostsResponse: defineInvoke({
    channel: `${namespace}:withdraw-boosts-response`,
    name: "environment.withdrawBoostsResponse",
    payload: Schema.Struct({
      itemIds: Schema.Array(PositiveInt),
      requestId: Schema.String,
    }),
    result: Schema.Void,
  }),
} as const;
