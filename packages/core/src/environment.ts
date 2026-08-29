import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";

import { PositiveInt, TrimmedNonEmptyString } from "./baseSchemas";

export const EnvironmentItemBuckets = [
  "ac-member",
  "ac-non-member",
  "non-ac-member",
  "non-ac-non-member",
] as const;

export const EnvironmentItemBucketSchema = Schema.Literals(
  EnvironmentItemBuckets,
);
export const EnvironmentItemRulesSchema = Schema.Struct({
  buckets: Schema.Array(EnvironmentItemBucketSchema),
  rejectElse: Schema.Boolean,
});
export const EnvironmentDropPolicySchema = Schema.Struct({
  /** Accept member-only AC-tagged items. */
  acceptAcMemberOnlyDrops: Schema.Boolean,
  /** Accept non-member AC-tagged items. */
  acceptAcNonMemberDrops: Schema.Boolean,
  /** Accept member-only non-AC items. */
  acceptNonAcMemberOnlyDrops: Schema.Boolean,
  /** Accept non-member non-AC items. */
  acceptNonAcNonMemberDrops: Schema.Boolean,
  /** Reject any unregistered drop that is not accepted by this policy. */
  rejectUnregisteredDrops: Schema.Boolean,
});
export const EnvironmentQuestAutoRegisterOptionsSchema = Schema.Struct({
  requirements: Schema.Boolean,
  rewards: Schema.Boolean,
});
export const EnvironmentAutomationOptionsSchema = Schema.Struct({
  boosts: Schema.Boolean,
  drops: Schema.Boolean,
  quests: Schema.Boolean,
});
export const EnvironmentAutomationCapabilities = [
  "boosts",
  "drops",
  "quests",
] as const;
export const EnvironmentAutomationCapabilitySchema = Schema.Literals(
  EnvironmentAutomationCapabilities,
);
export const EnvironmentDropItemDataSchema = Schema.Struct({
  coins: Schema.Boolean,
  memberOnly: Schema.Boolean,
  name: Schema.String,
});
export const EnvironmentStateSchema = Schema.Struct({
  automation: EnvironmentAutomationOptionsSchema,
  questIds: Schema.Array(PositiveInt),
  questAutoRegister: EnvironmentQuestAutoRegisterOptionsSchema,
  questRewards: Schema.Record(PositiveInt, PositiveInt),
  itemNames: Schema.Array(Schema.String),
  itemNotificationNames: Schema.Array(Schema.String),
  itemRules: EnvironmentItemRulesSchema,
  boosts: Schema.Array(Schema.String),
});

export type EnvironmentItemBucket = typeof EnvironmentItemBucketSchema.Type;
/**
 * @scriptingExpandSchema
 */
export type EnvironmentItemRules = typeof EnvironmentItemRulesSchema.Type;
/**
 * Handling options for drops that are not registered by name.
 *
 * @scriptingExpandSchema
 */
export type EnvironmentDropPolicy = typeof EnvironmentDropPolicySchema.Type;
/**
 * @scriptingExpandSchema
 */
export type EnvironmentQuestAutoRegisterOptions =
  typeof EnvironmentQuestAutoRegisterOptionsSchema.Type;
/**
 * @scriptingExpandSchema
 */
export type EnvironmentAutomationOptions =
  typeof EnvironmentAutomationOptionsSchema.Type;
export type EnvironmentAutomationCapability =
  typeof EnvironmentAutomationCapabilitySchema.Type;
/**
 * @scriptingExpandSchema
 */
export type EnvironmentDropItemData = typeof EnvironmentDropItemDataSchema.Type;
/**
 * @scriptingExpandSchema
 */
export type EnvironmentState = typeof EnvironmentStateSchema.Type;
export type EnvironmentDropAction = "accept" | "reject" | "ignore";

export const DEFAULT_ENVIRONMENT_ITEM_RULES: EnvironmentItemRules = {
  buckets: [],
  rejectElse: false,
};
export const DEFAULT_ENVIRONMENT_DROP_POLICY: EnvironmentDropPolicy = {
  acceptAcMemberOnlyDrops: false,
  acceptAcNonMemberDrops: false,
  acceptNonAcMemberOnlyDrops: false,
  acceptNonAcNonMemberDrops: false,
  rejectUnregisteredDrops: false,
};
export const DEFAULT_ENVIRONMENT_QUEST_AUTO_REGISTER: EnvironmentQuestAutoRegisterOptions =
  {
    requirements: false,
    rewards: false,
  };
export const DEFAULT_ENVIRONMENT_AUTOMATION_OPTIONS: EnvironmentAutomationOptions =
  {
    boosts: true,
    drops: true,
    quests: true,
  };

const PositiveIntFromNumber = Schema.Number.pipe(
  Schema.decodeTo(
    PositiveInt,
    SchemaTransformation.transform({
      decode: Math.trunc,
      encode: (value) => value,
    }),
  ),
);
const decodeQuestIdentifier = Schema.decodeUnknownOption(PositiveIntFromNumber);
const decodeTrimmedName = Schema.decodeUnknownOption(TrimmedNonEmptyString);
const isEnvironmentItemBucketValue = Schema.is(EnvironmentItemBucketSchema);

const toPositiveInt = (value: number): number | undefined =>
  Option.getOrUndefined(decodeQuestIdentifier(value));

const normalizeNames = (values: readonly string[]): readonly string[] => {
  const names = new Map<string, string>();
  for (const value of values) {
    const decoded = decodeTrimmedName(value);
    if (Option.isSome(decoded)) {
      const key = decoded.value.toLowerCase();
      if (!names.has(key)) {
        names.set(key, decoded.value);
      }
    }
  }
  return Array.from(names.values()).toSorted((left, right) =>
    left.localeCompare(right),
  );
};

const normalizeQuestIds = (values: readonly number[]): readonly number[] =>
  Array.from(
    new Set(values.flatMap((value) => toPositiveInt(value) ?? [])),
  ).toSorted((left, right) => left - right);

const normalizeQuestRewards = (
  questIds: readonly number[],
  rewards: Readonly<Record<number, number>>,
): Readonly<Record<number, number>> => {
  const registered = new Set(questIds);
  return Object.fromEntries(
    Object.entries(rewards)
      .flatMap(([questId, rewardItemId]) => {
        const normalizedQuestId = toPositiveInt(Number(questId));
        const normalizedRewardItemId = toPositiveInt(rewardItemId);
        return normalizedQuestId !== undefined &&
          normalizedRewardItemId !== undefined &&
          registered.has(normalizedQuestId)
          ? [[normalizedQuestId, normalizedRewardItemId] as const]
          : [];
      })
      .toSorted(([left], [right]) => left - right),
  );
};

export const isEnvironmentItemBucket = (
  value: unknown,
): value is EnvironmentItemBucket => isEnvironmentItemBucketValue(value);

export const normalizeEnvironmentItemRules = (
  rules: EnvironmentItemRules,
): EnvironmentItemRules => {
  const requested = new Set(rules.buckets.filter(isEnvironmentItemBucketValue));
  return {
    buckets: EnvironmentItemBuckets.filter((bucket) => requested.has(bucket)),
    rejectElse: rules.rejectElse,
  };
};

const bucketPolicyKeys = {
  "ac-member": "acceptAcMemberOnlyDrops",
  "ac-non-member": "acceptAcNonMemberDrops",
  "non-ac-member": "acceptNonAcMemberOnlyDrops",
  "non-ac-non-member": "acceptNonAcNonMemberDrops",
} as const satisfies Record<
  EnvironmentItemBucket,
  Exclude<keyof EnvironmentDropPolicy, "rejectUnregisteredDrops">
>;

export const environmentItemRulesToDropPolicy = (
  rules: EnvironmentItemRules,
): EnvironmentDropPolicy => {
  const buckets = new Set(normalizeEnvironmentItemRules(rules).buckets);
  return {
    acceptAcMemberOnlyDrops: buckets.has("ac-member"),
    acceptAcNonMemberDrops: buckets.has("ac-non-member"),
    acceptNonAcMemberOnlyDrops: buckets.has("non-ac-member"),
    acceptNonAcNonMemberDrops: buckets.has("non-ac-non-member"),
    rejectUnregisteredDrops: rules.rejectElse,
  };
};

export const environmentDropPolicyToItemRules = (
  policy: EnvironmentDropPolicy,
): EnvironmentItemRules => ({
  buckets: EnvironmentItemBuckets.filter(
    (bucket) => policy[bucketPolicyKeys[bucket]],
  ),
  rejectElse: policy.rejectUnregisteredDrops,
});

export const patchEnvironmentDropPolicy = (
  rules: EnvironmentItemRules,
  patch: Partial<EnvironmentDropPolicy>,
): EnvironmentItemRules =>
  environmentDropPolicyToItemRules({
    ...environmentItemRulesToDropPolicy(rules),
    ...patch,
  });

export const normalizeEnvironmentQuestAutoRegisterOptions = (
  options: EnvironmentQuestAutoRegisterOptions,
): EnvironmentQuestAutoRegisterOptions => ({
  requirements: options.requirements,
  rewards: options.rewards,
});

export const normalizeEnvironmentAutomationOptions = (
  options: EnvironmentAutomationOptions,
): EnvironmentAutomationOptions => ({
  boosts: options.boosts,
  drops: options.drops,
  quests: options.quests,
});

export const isEnvironmentItemRules = Schema.is(EnvironmentItemRulesSchema);
export const isEnvironmentQuestAutoRegisterOptions = Schema.is(
  EnvironmentQuestAutoRegisterOptionsSchema,
);

export const classifyEnvironmentDropItem = (
  item: EnvironmentDropItemData,
): EnvironmentItemBucket => {
  if (item.coins && item.memberOnly) {
    return "ac-member";
  }
  if (item.coins) {
    return "ac-non-member";
  }
  return item.memberOnly ? "non-ac-member" : "non-ac-non-member";
};

export const hasEnvironmentItemName = (
  state: Pick<EnvironmentState, "itemNames">,
  itemName: string,
): boolean => {
  const key = itemName.trim().toLowerCase();
  return state.itemNames.some((registered) => registered.toLowerCase() === key);
};

export const resolveEnvironmentDropAction = (
  state: Pick<EnvironmentState, "itemNames" | "itemRules">,
  item: EnvironmentDropItemData,
): EnvironmentDropAction => {
  if (hasEnvironmentItemName(state, item.name)) {
    return "accept";
  }
  if (state.itemRules.buckets.includes(classifyEnvironmentDropItem(item))) {
    return "accept";
  }
  return state.itemRules.rejectElse ? "reject" : "ignore";
};

export const createEmptyEnvironmentState = (): EnvironmentState => ({
  automation: DEFAULT_ENVIRONMENT_AUTOMATION_OPTIONS,
  questIds: [],
  questAutoRegister: DEFAULT_ENVIRONMENT_QUEST_AUTO_REGISTER,
  questRewards: {},
  itemNames: [],
  itemNotificationNames: [],
  itemRules: DEFAULT_ENVIRONMENT_ITEM_RULES,
  boosts: [],
});

export const normalizeEnvironmentState = (
  state: EnvironmentState,
): EnvironmentState => {
  const questIds = normalizeQuestIds(state.questIds);
  const itemNames = normalizeNames(state.itemNames);
  const itemNameKeys = new Set(itemNames.map((name) => name.toLowerCase()));
  return {
    automation: normalizeEnvironmentAutomationOptions(state.automation),
    questIds,
    questAutoRegister: normalizeEnvironmentQuestAutoRegisterOptions(
      state.questAutoRegister,
    ),
    questRewards: normalizeQuestRewards(questIds, state.questRewards),
    itemNames,
    itemNotificationNames: normalizeNames(state.itemNotificationNames).filter(
      (name) => itemNameKeys.has(name.toLowerCase()),
    ),
    itemRules: normalizeEnvironmentItemRules(state.itemRules),
    boosts: normalizeNames(state.boosts),
  };
};

const updateEnvironmentState = (
  state: EnvironmentState,
  patch: Partial<EnvironmentState>,
): EnvironmentState => normalizeEnvironmentState({ ...state, ...patch });

export const addEnvironmentQuest = (
  state: EnvironmentState,
  questId: number,
  rewardItemId?: number,
): EnvironmentState => {
  const normalizedQuestId = toPositiveInt(questId);
  if (normalizedQuestId === undefined) {
    return normalizeEnvironmentState(state);
  }
  const normalizedRewardItemId =
    rewardItemId === undefined ? undefined : toPositiveInt(rewardItemId);
  return updateEnvironmentState(state, {
    questIds: [...state.questIds, normalizedQuestId],
    ...(normalizedRewardItemId === undefined
      ? {}
      : {
          questRewards: {
            ...state.questRewards,
            [normalizedQuestId]: normalizedRewardItemId,
          },
        }),
  });
};

export interface EnvironmentQuestRegistration {
  readonly questId: number;
  readonly rewardItemId?: number;
}

export const addEnvironmentQuests = (
  state: EnvironmentState,
  quests: readonly EnvironmentQuestRegistration[],
): EnvironmentState =>
  quests.reduce(
    (current, quest) =>
      addEnvironmentQuest(current, quest.questId, quest.rewardItemId),
    state,
  );

export const removeEnvironmentQuest = (
  state: EnvironmentState,
  questId: number,
): EnvironmentState => {
  const normalizedQuestId = toPositiveInt(questId);
  if (normalizedQuestId === undefined) {
    return normalizeEnvironmentState(state);
  }
  const { [normalizedQuestId]: _removed, ...questRewards } = state.questRewards;
  return updateEnvironmentState(state, {
    questIds: state.questIds.filter((id) => id !== normalizedQuestId),
    questRewards,
  });
};

export const setEnvironmentQuestReward = (
  state: EnvironmentState,
  questId: number,
  rewardItemId: number,
): EnvironmentState => {
  const normalizedQuestId = toPositiveInt(questId);
  const normalizedRewardItemId = toPositiveInt(rewardItemId);
  return normalizedQuestId === undefined || normalizedRewardItemId === undefined
    ? normalizeEnvironmentState(state)
    : addEnvironmentQuest(state, normalizedQuestId, normalizedRewardItemId);
};

export const clearEnvironmentQuestReward = (
  state: EnvironmentState,
  questId: number,
): EnvironmentState => {
  const normalizedQuestId = toPositiveInt(questId);
  if (normalizedQuestId === undefined) {
    return normalizeEnvironmentState(state);
  }
  const { [normalizedQuestId]: _removed, ...questRewards } = state.questRewards;
  return updateEnvironmentState(state, { questRewards });
};

export const clearEnvironmentQuests = (
  state: EnvironmentState,
): EnvironmentState =>
  updateEnvironmentState(state, { questIds: [], questRewards: {} });

export const setEnvironmentQuestAutoRegisterOptions = (
  state: EnvironmentState,
  questAutoRegister: EnvironmentQuestAutoRegisterOptions,
): EnvironmentState => updateEnvironmentState(state, { questAutoRegister });

export const setEnvironmentAutomationOptions = (
  state: EnvironmentState,
  automation: EnvironmentAutomationOptions,
): EnvironmentState => updateEnvironmentState(state, { automation });

export const setEnvironmentAutomationEnabled = (
  state: EnvironmentState,
  capability: EnvironmentAutomationCapability,
  enabled: boolean,
): EnvironmentState =>
  setEnvironmentAutomationOptions(state, {
    ...state.automation,
    [capability]: enabled,
  });

export const addEnvironmentItem = (
  state: EnvironmentState,
  name: string,
): EnvironmentState =>
  updateEnvironmentState(state, {
    itemNames: [...state.itemNames, name],
  });

export const addEnvironmentItems = (
  state: EnvironmentState,
  names: readonly string[],
): EnvironmentState =>
  updateEnvironmentState(state, {
    itemNames: [...state.itemNames, ...names],
  });

export const removeEnvironmentItem = (
  state: EnvironmentState,
  name: string,
): EnvironmentState => {
  const key = name.trim().toLowerCase();
  return updateEnvironmentState(state, {
    itemNames: state.itemNames.filter(
      (registered) => registered.toLowerCase() !== key,
    ),
  });
};

export const setEnvironmentItemRules = (
  state: EnvironmentState,
  itemRules: EnvironmentItemRules,
): EnvironmentState => updateEnvironmentState(state, { itemRules });

export const setEnvironmentItemNotification = (
  state: EnvironmentState,
  name: string,
  enabled: boolean,
): EnvironmentState => {
  const key = name.trim().toLowerCase();
  const registered = state.itemNames.find(
    (itemName) => itemName.toLowerCase() === key,
  );
  if (registered === undefined) {
    return normalizeEnvironmentState(state);
  }

  return updateEnvironmentState(state, {
    itemNotificationNames: enabled
      ? [...state.itemNotificationNames, registered]
      : state.itemNotificationNames.filter(
          (itemName) => itemName.toLowerCase() !== key,
        ),
  });
};

export const setEnvironmentDropPolicy = (
  state: EnvironmentState,
  policy: Partial<EnvironmentDropPolicy>,
): EnvironmentState =>
  setEnvironmentItemRules(
    state,
    patchEnvironmentDropPolicy(state.itemRules, policy),
  );

export const clearEnvironmentItems = (
  state: EnvironmentState,
): EnvironmentState =>
  updateEnvironmentState(state, {
    itemNames: [],
    itemNotificationNames: [],
  });

export const addEnvironmentBoost = (
  state: EnvironmentState,
  name: string,
): EnvironmentState =>
  updateEnvironmentState(state, { boosts: [...state.boosts, name] });

export const addEnvironmentBoosts = (
  state: EnvironmentState,
  boosts: readonly string[],
): EnvironmentState =>
  updateEnvironmentState(state, {
    boosts: [...state.boosts, ...boosts],
  });

export const removeEnvironmentBoost = (
  state: EnvironmentState,
  name: string,
): EnvironmentState => {
  const key = name.trim().toLowerCase();
  return updateEnvironmentState(state, {
    boosts: state.boosts.filter(
      (registered) => registered.toLowerCase() !== key,
    ),
  });
};

export const clearEnvironmentBoosts = (
  state: EnvironmentState,
): EnvironmentState => updateEnvironmentState(state, { boosts: [] });

export const clearEnvironmentState = (
  state: EnvironmentState,
): EnvironmentState =>
  updateEnvironmentState(state, {
    boosts: [],
    itemNames: [],
    itemNotificationNames: [],
    questIds: [],
    questRewards: {},
  });

export const areEnvironmentStatesEqual = (
  left: EnvironmentState,
  right: EnvironmentState,
): boolean =>
  JSON.stringify(normalizeEnvironmentState(left)) ===
  JSON.stringify(normalizeEnvironmentState(right));
