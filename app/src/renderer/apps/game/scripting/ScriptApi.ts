import type {
  AuraQueryOptions,
  BoostType,
  EntityState,
  ItemQuery,
  LiveAura,
  LiveFaction,
  LiveItem,
  LiveMonster,
  LiveOutfit,
  LivePlayer,
  LiveQuest,
  LiveServer,
  LiveShop,
  MonsterQuery,
  PlayerQuery,
  Position,
  ShopItemQuery,
} from "@lucent/game";
import type * as Duration from "effect/Duration";
import type * as Effect from "effect/Effect";
import type * as Option from "effect/Option";
import type * as Scope from "effect/Scope";
import type { pipe } from "effect/Function";

import type { RoomPolicy } from "@lucent/core/accountSettings";
import type {
  EnvironmentDropPolicy,
  EnvironmentState,
} from "@lucent/core/environment";
import type {
  ScriptInputsDefinition,
  ScriptInputValue,
  ScriptInputValues,
} from "@lucent/core/scriptInputs";
import type {
  ArmyEquipSetOptions,
  ArmyError,
  ArmyRunStepOptions,
  ArmySession,
} from "../army/Army";
import type {
  ArmyLoopTauntError,
  ArmyLoopTauntHandle,
  ArmyLoopTauntPlan,
} from "../army/ArmyLoopTaunt";
import type {
  AutoReloginLoginError,
  AutoReloginLoginRequest,
  AutoReloginLoginResult,
  AutoReloginState,
} from "../automation/AutoRelogin";
import type {
  AutoZoneState,
  AutoZoneSupportedMap,
} from "../automation/AutoZone";
import type { ConnectOutcome } from "../flash/api/Auth";
import type { BankOpenOptions } from "../flash/api/Bank";
import type {
  CombatKillOptions,
  HuntOptions,
  SkillSlot,
  SkillUseOptions,
} from "../flash/api/Combat";
import type { EquipOptions } from "../flash/api/Inventory";
import type { CellPositionOptions } from "../flash/api/Map";
import type {
  ClientPacketEncoding,
  ServerPacketEncoding,
} from "../flash/api/Packet";
import type { RestOptions, WalkToOptions } from "../flash/api/Player";
import type { CompleteQuestOptions } from "../flash/api/Quests";
import type {
  EventSelector,
  ProjectionEvent,
  RuntimeEvent,
} from "../flash/contract/Event";
import type { GameAction } from "../flash/contract/GameAction";
import type {
  Packet,
  PacketDirection,
  PacketForDirection,
  PacketSelector,
  WaitOptions,
} from "../flash/contract/Packet";
import type { TriggeredWaitOptions } from "../flash/protocol/Wait";
import type { BankView } from "../Types";
import type { ScriptCallbackResult, ScriptGenerator } from "./api/Callbacks";
import type {
  ScriptExecutionError,
  ScriptStopSignal,
} from "./ScriptRunnerErrors";

export type ScriptEffect<A = unknown, E = unknown> = Effect.Effect<A, E>;

export type { ScriptCallbackResult, ScriptGenerator };

export type { ScriptInputType } from "@lucent/core/scriptInputs";

export type { ScriptInputsDefinition, ScriptInputValue, ScriptInputValues };
export type { RoomPolicy };

export type ScriptEvent = RuntimeEvent | ProjectionEvent;
export type ScriptEventType = ScriptEvent["type"];
export type ScriptEventSelector = EventSelector;

export type ScriptEventForType<T extends ScriptEventType> = Extract<
  ScriptEvent,
  { readonly type: T }
>;

export type ScriptEventSelectorForType<T extends ScriptEventType> =
  ScriptEventSelector & {
    readonly type: T;
  };

export interface ScriptArmyApi {
  readonly equipSet: (
    setName: string,
    options?: ArmyEquipSetOptions,
  ) => Effect.Effect<void, ArmyError>;
  readonly getConfigString: (
    key: string,
    defaultValue?: string,
  ) => Effect.Effect<string>;
  readonly getConfigValue: (
    key: string,
    defaultValue?: unknown,
  ) => Effect.Effect<unknown>;
  readonly getPlayerNumber: () => Effect.Effect<number | null>;
  readonly getSession: () => Effect.Effect<ArmySession | null>;
  readonly isLeader: () => Effect.Effect<boolean>;
  readonly isMember: () => Effect.Effect<boolean>;
  readonly isStarted: () => Effect.Effect<boolean>;
  readonly joinMap: (
    map: string,
    options?: CellPositionOptions,
  ) => Effect.Effect<void, ArmyError>;
  readonly kill: (
    target: MonsterQuery,
    options?: CombatKillOptions,
  ) => Effect.Effect<void, ArmyError>;
  /** @param quantity The minimum quantity to collect. */
  readonly killForItem: (
    target: MonsterQuery,
    item: ItemQuery,
    /** @defaultValue 1 */
    quantity?: number,
    options?: CombatKillOptions,
  ) => Effect.Effect<void, ArmyError>;
  /** @param quantity The minimum quantity to collect. */
  readonly killForTempItem: (
    target: MonsterQuery,
    item: ItemQuery,
    /** @defaultValue 1 */
    quantity?: number,
    options?: CombatKillOptions,
  ) => Effect.Effect<void, ArmyError>;
  readonly leave: () => Effect.Effect<void>;
  readonly runStep: <A, E>(
    label: string,
    action: Effect.Effect<A, E>,
    options?: ArmyRunStepOptions,
  ) => Effect.Effect<A, E | ArmyError>;
  readonly start: (configName: string) => Effect.Effect<ArmySession, ArmyError>;
  /**
   * Starts a map-scoped Loop Taunt plan across the full Army roster.
   *
   * @param plan The ordered target priority groups every participant runs.
   */
  readonly loopTaunt: (
    plan: ArmyLoopTauntPlan,
  ) => Effect.Effect<ArmyLoopTauntHandle, ArmyLoopTauntError>;
  /** @param label The coordination label. */
  readonly sync: (
    /** @defaultValue "sync" */
    label?: string,
    options?: ArmyRunStepOptions,
  ) => Effect.Effect<void, ArmyError>;
  readonly waitForAllInMap: () => Effect.Effect<void, ArmyError>;
}

export interface ScriptAuthApi {
  readonly connectTo: (server: string) => Effect.Effect<ConnectOutcome>;
  readonly getPassword: () => Effect.Effect<string>;
  readonly getServers: () => Effect.Effect<readonly LiveServer[]>;
  readonly getUsername: () => Effect.Effect<string>;
  readonly isLoggedIn: () => Effect.Effect<boolean>;
  readonly isServerSelectReady: () => Effect.Effect<boolean>;
  readonly isTemporarilyKicked: () => Effect.Effect<boolean>;
  readonly login: (
    username: string,
    password: string,
  ) => Effect.Effect<boolean>;
  readonly logout: () => Effect.Effect<void>;
}

export interface ScriptBankApi {
  /** @param quantity The minimum quantity required. */
  readonly contains: (
    query: ItemQuery,
    /** @defaultValue 1 */
    quantity?: number,
  ) => Effect.Effect<boolean>;
  readonly deposit: (query: ItemQuery) => Effect.Effect<boolean>;
  readonly depositBatch: (
    selectors: readonly ItemQuery[],
  ) => Effect.Effect<boolean[]>;
  readonly get: (query: ItemQuery) => Effect.Effect<LiveItem | null>;
  readonly getAll: () => Effect.Effect<readonly LiveItem[]>;
  readonly getAvailableSlots: () => Effect.Effect<number>;
  readonly getSlots: () => Effect.Effect<number>;
  readonly getUsedSlots: () => Effect.Effect<number>;
  readonly isOpen: (view?: BankView) => Effect.Effect<boolean>;
  /** @param force Whether to reload an already loaded bank. */
  readonly load: (
    /** @defaultValue false */
    force?: boolean,
  ) => Effect.Effect<boolean>;
  readonly open: (
    /** @defaultValue {} */
    options?: BankOpenOptions,
  ) => Effect.Effect<boolean>;
  readonly swap: (
    inventoryQuery: ItemQuery,
    bankQuery: ItemQuery,
  ) => Effect.Effect<boolean>;
  readonly withdraw: (query: ItemQuery) => Effect.Effect<boolean>;
  readonly withdrawBatch: (
    selectors: readonly ItemQuery[],
  ) => Effect.Effect<boolean[]>;
}

export interface ScriptAurasApi {
  readonly get: (
    name: string,
    options?: AuraQueryOptions,
  ) => Effect.Effect<LiveAura | null>;
  readonly getAll: (
    options?: AuraQueryOptions,
  ) => Effect.Effect<readonly LiveAura[]>;
  readonly has: (
    name: string,
    options?: AuraQueryOptions,
  ) => Effect.Effect<boolean>;
}

export interface ScriptCombatMonsterTarget {
  readonly cell: string;
  readonly hp: number;
  readonly level: number;
  readonly maxHp: number;
  readonly monsterId: number;
  readonly monsterMapId: number;
  readonly name: string;
  readonly race: string;
  readonly state: number;
  readonly type: "monster";
}

export interface ScriptCombatPlayerTarget {
  readonly afk: boolean;
  readonly cell: string;
  readonly entityId: number;
  readonly entityType: string;
  readonly hp: number;
  readonly level: number;
  readonly maxHp: number;
  readonly maxMp: number;
  readonly mp: number;
  readonly name: string;
  readonly pad: string;
  readonly sp: number;
  readonly state: number;
  readonly type: "player";
  readonly username: string;
}

export type ScriptCombatTarget =
  | ScriptCombatMonsterTarget
  | ScriptCombatPlayerTarget;

export interface ScriptCombatTargetApi {
  readonly auras: ScriptAurasApi;
  readonly get: () => Effect.Effect<ScriptCombatTarget | null>;
}

export interface ScriptCombatApi {
  readonly attack: (target: MonsterQuery) => Effect.Effect<boolean>;
  readonly cancelAutoAttack: () => Effect.Effect<void>;
  readonly cancelTarget: () => Effect.Effect<void>;
  readonly canUseSkill: (skill: SkillSlot) => Effect.Effect<boolean>;
  readonly exit: () => Effect.Effect<boolean>;
  readonly getSkillCooldownRemainingMs: (
    skill: SkillSlot,
  ) => Effect.Effect<number | null>;
  readonly hunt: (
    query: MonsterQuery,
    options?: HuntOptions,
  ) => Effect.Effect<LiveMonster | null>;
  readonly kill: (
    query: MonsterQuery,
    options?: CombatKillOptions,
  ) => Effect.Effect<boolean>;
  /** @param quantity The minimum quantity to collect. */
  readonly killForItem: (
    query: MonsterQuery,
    item: ItemQuery,
    /** @defaultValue 1 */
    quantity?: number,
    options?: CombatKillOptions,
  ) => Effect.Effect<boolean>;
  /** @param quantity The minimum quantity to collect. */
  readonly killForTempItem: (
    query: MonsterQuery,
    item: ItemQuery,
    /** @defaultValue 1 */
    quantity?: number,
    options?: CombatKillOptions,
  ) => Effect.Effect<boolean>;
  readonly target: ScriptCombatTargetApi;
  readonly useSkill: (
    skill: SkillSlot,
    options?: SkillUseOptions,
  ) => Effect.Effect<boolean>;
}

export interface ScriptDropsApi {
  readonly accept: (query: ItemQuery) => Effect.Effect<boolean>;
  readonly contains: (query: ItemQuery) => Effect.Effect<boolean>;
  readonly get: (query: ItemQuery) => Effect.Effect<LiveItem | null>;
  readonly getAll: () => Effect.Effect<readonly LiveItem[]>;
  readonly reject: (query: ItemQuery) => Effect.Effect<boolean>;
}

export interface ScriptEnvironmentApi {
  readonly getState: () => Effect.Effect<EnvironmentState, unknown>;
  readonly clear: () => Effect.Effect<EnvironmentState, unknown>;
  readonly addQuest: (
    questId: number,
    rewardItemId?: number,
  ) => Effect.Effect<EnvironmentState, unknown>;
  readonly removeQuest: (
    questId: number,
  ) => Effect.Effect<EnvironmentState, unknown>;
  readonly setQuestReward: (
    questId: number,
    rewardItemId: number,
  ) => Effect.Effect<EnvironmentState, unknown>;
  readonly clearQuestReward: (
    questId: number,
  ) => Effect.Effect<EnvironmentState, unknown>;
  readonly clearQuests: () => Effect.Effect<EnvironmentState, unknown>;
  /** Enable or disable auto-registration of quest requirements in the drop list. */
  readonly setAutoRegisterRequirements: (
    enabled: boolean,
  ) => Effect.Effect<EnvironmentState, unknown>;
  /** Enable or disable auto-registration of quest rewards in the drop list. */
  readonly setAutoRegisterRewards: (
    enabled: boolean,
  ) => Effect.Effect<EnvironmentState, unknown>;
  readonly addItem: (name: string) => Effect.Effect<EnvironmentState, unknown>;
  readonly removeItem: (
    name: string,
  ) => Effect.Effect<EnvironmentState, unknown>;
  /** Accept or ignore member-only AC-tagged items. */
  readonly setAcceptAcMemberOnlyDrops: (
    enabled: boolean,
  ) => Effect.Effect<EnvironmentState, unknown>;
  /** Accept or ignore non-member AC-tagged items. */
  readonly setAcceptAcNonMemberDrops: (
    enabled: boolean,
  ) => Effect.Effect<EnvironmentState, unknown>;
  /** Accept or ignore member-only non-AC items. */
  readonly setAcceptNonAcMemberOnlyDrops: (
    enabled: boolean,
  ) => Effect.Effect<EnvironmentState, unknown>;
  /** Accept or ignore non-member non-AC items. */
  readonly setAcceptNonAcNonMemberDrops: (
    enabled: boolean,
  ) => Effect.Effect<EnvironmentState, unknown>;
  /** Reject or ignore unregistered drops that are not accepted by policy. */
  readonly setRejectUnregisteredDrops: (
    enabled: boolean,
  ) => Effect.Effect<EnvironmentState, unknown>;
  /** Update one or more drop-handling options. */
  readonly setDropPolicy: (
    policy: Partial<EnvironmentDropPolicy>,
  ) => Effect.Effect<EnvironmentState, unknown>;
  readonly clearItems: () => Effect.Effect<EnvironmentState, unknown>;
  readonly addBoost: (name: string) => Effect.Effect<EnvironmentState, unknown>;
  readonly removeBoost: (
    name: string,
  ) => Effect.Effect<EnvironmentState, unknown>;
  readonly clearBoosts: () => Effect.Effect<EnvironmentState, unknown>;
  readonly fetchBoosts: () => Effect.Effect<readonly string[], unknown>;
  /** Enable or pause automatic boost use. */
  readonly setBoostAutomationEnabled: (
    enabled: boolean,
  ) => Effect.Effect<EnvironmentState, unknown>;
  /** Enable or pause automatic drop acceptance and rejection. */
  readonly setDropAutomationEnabled: (
    enabled: boolean,
  ) => Effect.Effect<EnvironmentState, unknown>;
  readonly setItemNotification: (
    name: string,
    enabled: boolean,
  ) => Effect.Effect<EnvironmentState, unknown>;
  /** Enable or pause automatic quest acceptance and completion. */
  readonly setQuestAutomationEnabled: (
    enabled: boolean,
  ) => Effect.Effect<EnvironmentState, unknown>;
  readonly syncToAll: () => Effect.Effect<EnvironmentState, unknown>;
}

export interface ScriptEventsOn {
  <const T extends ScriptEventType>(
    query: ScriptEventSelectorForType<T>,
    handler: (event: ScriptEventForType<T>) => ScriptCallbackResult,
  ): Effect.Effect<() => void>;
  (
    query: undefined,
    handler: (event: ScriptEvent) => ScriptCallbackResult,
  ): Effect.Effect<() => void>;
  (
    query: ScriptEventSelector | undefined,
    handler: (event: ScriptEvent) => ScriptCallbackResult,
  ): Effect.Effect<() => void>;
}

export interface ScriptWaitForEvent {
  <const T extends ScriptEventType, E = never, R = never>(
    query: ScriptEventSelectorForType<T>,
    options?: TriggeredWaitOptions<E, R>,
  ): Effect.Effect<ScriptEventForType<T> | null, E, Exclude<R, Scope.Scope>>;
  <E = never, R = never>(
    selector?: ScriptEventSelector,
    options?: TriggeredWaitOptions<E, R>,
  ): Effect.Effect<ScriptEvent | null, E, Exclude<R, Scope.Scope>>;
}

export interface ScriptEventsApi {
  readonly on: ScriptEventsOn;
  readonly once: ScriptWaitForEvent;
}

export interface ScriptHouseApi {
  /** @param quantity The minimum quantity required. */
  readonly contains: (
    query: ItemQuery,
    /** @defaultValue 1 */
    quantity?: number,
  ) => Effect.Effect<boolean>;
  readonly get: (query: ItemQuery) => Effect.Effect<LiveItem | null>;
  readonly getAll: () => Effect.Effect<readonly LiveItem[]>;
  readonly getAvailableSlots: () => Effect.Effect<number>;
  readonly getSlots: () => Effect.Effect<number>;
  readonly getUsedSlots: () => Effect.Effect<number>;
}

export interface ScriptEquipEnhancementSelector {
  readonly enhancement: string;
  readonly slot?: "cape" | "class" | "helm" | "weapon";
  readonly special?: string;
}

export interface ScriptInventoryApi {
  /** @param quantity The minimum quantity required. */
  readonly contains: (
    query: ItemQuery,
    /** @defaultValue 1 */
    quantity?: number,
  ) => Effect.Effect<boolean>;
  readonly equip: (
    query: ItemQuery,
    options?: EquipOptions,
  ) => Effect.Effect<boolean>;
  readonly equipByEnhancement: (
    query: ScriptEquipEnhancementSelector,
    options?: EquipOptions,
  ) => Effect.Effect<boolean>;
  readonly get: (query: ItemQuery) => Effect.Effect<LiveItem | null>;
  readonly getAll: () => Effect.Effect<readonly LiveItem[]>;
  readonly getAvailableSlots: () => Effect.Effect<number>;
  readonly getSlots: () => Effect.Effect<number>;
  readonly getUsedSlots: () => Effect.Effect<number>;
  readonly unequipConsumable: (query: ItemQuery) => Effect.Effect<boolean>;
  /** Uses an eligible item directly from inventory, such as a Tonic, Elixir, or boost. */
  readonly use: (query: ItemQuery) => Effect.Effect<boolean>;
  readonly wear: (query: ItemQuery) => Effect.Effect<boolean>;
}

export interface ScriptMapApi {
  readonly getCellPads: () => Effect.Effect<readonly string[]>;
  readonly getCells: () => Effect.Effect<readonly string[]>;
  readonly getId: () => Effect.Effect<number>;
  readonly getMapItem: (itemId: number) => Effect.Effect<void>;
  readonly getName: () => Effect.Effect<string>;
  readonly getRoomNumber: () => Effect.Effect<number>;
  readonly isLoaded: () => Effect.Effect<boolean>;
  readonly loadSwf: (swf: string) => Effect.Effect<void>;
  readonly reload: () => Effect.Effect<void>;
  /** Sets the spawn point, using the current cell or pad when omitted. */
  readonly setSpawnPoint: (
    options?: CellPositionOptions,
  ) => Effect.Effect<void>;
}

export interface ScriptMonstersApi {
  readonly get: (query: MonsterQuery) => Effect.Effect<LiveMonster | null>;
  readonly getAll: () => Effect.Effect<readonly LiveMonster[]>;
  /** Gets monsters in the current cell that are alive and can be targeted for combat. Hidden monsters are included. */
  readonly getAvailable: () => Effect.Effect<readonly LiveMonster[]>;
  /** Checks whether a monster in the current cell is alive and can be targeted for combat. Hidden monsters count as available. */
  readonly isAvailable: (query: MonsterQuery) => Effect.Effect<boolean>;
}

export interface ScriptPacketOn {
  <const D extends PacketDirection>(
    query: PacketSelector & { readonly direction: D },
    handler: (packet: PacketForDirection<D>) => ScriptCallbackResult,
  ): Effect.Effect<() => void>;
  (
    query: PacketSelector | undefined,
    handler: (packet: Packet) => ScriptCallbackResult,
  ): Effect.Effect<() => void>;
}

export interface ScriptWaitForPacket {
  <const D extends PacketDirection, E = never, R = never>(
    query: PacketSelector & { readonly direction: D },
    options?: TriggeredWaitOptions<E, R>,
  ): Effect.Effect<PacketForDirection<D> | null, E, Exclude<R, Scope.Scope>>;
  <E = never, R = never>(
    selector?: PacketSelector,
    options?: TriggeredWaitOptions<E, R>,
  ): Effect.Effect<Packet | null, E, Exclude<R, Scope.Scope>>;
}

export interface ScriptPacketApi {
  readonly on: ScriptPacketOn;
  readonly once: ScriptWaitForPacket;
  /** @param encoding The client packet encoding. */
  readonly sendToClient: (
    packet: string,
    /** @defaultValue "string" */
    encoding?: ClientPacketEncoding,
  ) => Effect.Effect<boolean>;
  /** @param encoding The server packet encoding. */
  readonly sendToServer: (
    packet: string,
    /** @defaultValue "string" */
    encoding?: ServerPacketEncoding,
  ) => Effect.Effect<boolean>;
}

export interface ScriptPlayerFactionsApi {
  readonly get: (query: string | number) => Effect.Effect<LiveFaction | null>;
  readonly getAll: () => Effect.Effect<readonly LiveFaction[]>;
}

export interface ScriptPlayerOutfitsApi {
  /** @param keepColors Whether to preserve the current colors. */
  readonly equip: (
    name: string,
    /** @defaultValue false */
    keepColors?: boolean,
  ) => Effect.Effect<boolean>;
  readonly get: (name: string) => Effect.Effect<LiveOutfit | null>;
  readonly getAll: () => Effect.Effect<readonly LiveOutfit[]>;
  /** @param keepColors Whether to preserve the current colors. */
  readonly wear: (
    name: string,
    /** @defaultValue false */
    keepColors?: boolean,
  ) => Effect.Effect<boolean>;
}

export interface ScriptPlayerApi {
  readonly auras: ScriptAurasApi;
  readonly factions: ScriptPlayerFactionsApi;
  readonly get: () => Effect.Effect<LivePlayer | null>;
  readonly getCell: () => Effect.Effect<string>;
  readonly getClassName: () => Effect.Effect<string>;
  readonly getClassRank: (
    /** @defaultValue equipped inventory class */
    query?: ItemQuery,
  ) => Effect.Effect<number | null>;
  readonly getGender: () => Effect.Effect<string>;
  readonly getGold: () => Effect.Effect<number>;
  readonly getHp: () => Effect.Effect<number>;
  readonly getLevel: () => Effect.Effect<number>;
  readonly getMaxHp: () => Effect.Effect<number>;
  readonly getMaxMp: () => Effect.Effect<number>;
  readonly getMp: () => Effect.Effect<number>;
  readonly getPad: () => Effect.Effect<string>;
  readonly getPosition: () => Effect.Effect<Position>;
  readonly getState: () => Effect.Effect<EntityState>;
  readonly goToPlayer: (name: string) => Effect.Effect<void>;
  readonly hasActiveBoost: (boostType: BoostType) => Effect.Effect<boolean>;
  readonly isAfk: () => Effect.Effect<boolean>;
  readonly isAlive: () => Effect.Effect<boolean>;
  readonly isMember: () => Effect.Effect<boolean>;
  /**
   * Returns whether projections are complete and the account, map, and player are loaded.
   * Use before actions that require a fully loaded player.
   */
  readonly isReady: () => Effect.Effect<boolean>;
  readonly joinMap: (
    target: string,
    options?: CellPositionOptions,
  ) => Effect.Effect<boolean>;
  readonly jumpToCell: (cell: string, pad?: string) => Effect.Effect<boolean>;
  readonly outfits: ScriptPlayerOutfitsApi;
  readonly rest: (
    /** @defaultValue {} */
    options?: RestOptions,
  ) => Effect.Effect<boolean>;
  readonly walkTo: (
    position: Position,
    options?: WalkToOptions,
  ) => Effect.Effect<boolean>;
}

export interface ScriptPlayersApi {
  readonly get: (query: PlayerQuery) => Effect.Effect<LivePlayer | null>;
  readonly getAll: () => Effect.Effect<readonly LivePlayer[]>;
  readonly getMe: () => Effect.Effect<LivePlayer | null>;
}

export interface ScriptQuestsApi {
  readonly abandon: (questId: number) => Effect.Effect<boolean>;
  /** @param silent Whether to load the quest without opening its UI. */
  readonly accept: (
    questId: number,
    /** @defaultValue false */
    silent?: boolean,
  ) => Effect.Effect<boolean>;
  /** @param silent Whether to load the quests without opening their UI. */
  readonly acceptBatch: (
    questIds: readonly number[],
    /** @defaultValue false */
    silent?: boolean,
  ) => Effect.Effect<boolean[]>;
  readonly canComplete: (questId: number) => Effect.Effect<boolean>;
  readonly complete: (
    questId: number,
    options?: CompleteQuestOptions,
  ) => Effect.Effect<boolean>;
  readonly get: (questId: number) => Effect.Effect<LiveQuest | null>;
  readonly getAccepted: () => Effect.Effect<readonly LiveQuest[]>;
  readonly getAll: () => Effect.Effect<readonly LiveQuest[]>;
  readonly getMaxTurnIns: (questId: number) => Effect.Effect<number>;
  readonly isAvailable: (questId: number) => Effect.Effect<boolean>;
  readonly isInProgress: (questId: number) => Effect.Effect<boolean>;
  /** @param silent Whether to load the quest without opening its UI. */
  readonly load: (
    questId: number,
    /** @defaultValue false */
    silent?: boolean,
  ) => Effect.Effect<boolean>;
  /** @param silent Whether to load the quests without opening their UI. */
  readonly loadBatch: (
    questIds: readonly number[],
    /** @defaultValue false */
    silent?: boolean,
  ) => Effect.Effect<boolean[]>;
}

export interface ScriptEnhanceItemOptions {
  readonly enhancement: string;
  readonly special?: string;
}

export interface ScriptRecipesApi {
  /** @param toBank Whether to send wheel rewards to the bank. */
  readonly doWheelOfDoom: (
    /** @defaultValue false */
    toBank?: boolean,
  ) => Effect.Effect<boolean>;
  readonly ensureLifeSteal: (quantity: number) => Effect.Effect<boolean>;
  readonly ensureScrollOfEnrage: (quantity: number) => Effect.Effect<boolean>;
}

/** Controls game render visibility. */
export type ScriptRenderingMode =
  | "full"
  | /** A.k.a. Lag Killer. */ "interface-only"
  | "minimal";

export interface ScriptSettingsApi {
  /** Returns the active rendering mode. */
  readonly getRenderingMode: () => Effect.Effect<ScriptRenderingMode>;
  readonly isAntiCounterEnabled: () => Effect.Effect<boolean>;
  readonly setAnimationsEnabled: (enabled: boolean) => Effect.Effect<void>;
  readonly setAntiCounterEnabled: (enabled: boolean) => Effect.Effect<void>;
  readonly setCollisionsEnabled: (enabled: boolean) => Effect.Effect<void>;
  readonly setCustomGuild: (name: string) => Effect.Effect<void>;
  readonly setCustomName: (name: string) => Effect.Effect<void>;
  readonly setDeathAdsVisible: (visible: boolean) => Effect.Effect<void>;
  readonly setEnemyMagnetEnabled: (enabled: boolean) => Effect.Effect<void>;
  readonly setFrameRate: (fps: number) => Effect.Effect<void>;
  readonly setInfiniteRangeEnabled: (enabled: boolean) => Effect.Effect<void>;
  readonly setOtherPlayersVisible: (visible: boolean) => Effect.Effect<void>;
  readonly setProvokeCellEnabled: (enabled: boolean) => Effect.Effect<void>;
  /** @param mode The rendering mode to activate. */
  readonly setRenderingMode: (mode: ScriptRenderingMode) => Effect.Effect<void>;
  readonly setSkipCutscenesEnabled: (enabled: boolean) => Effect.Effect<void>;
  readonly setWalkSpeed: (speed: number) => Effect.Effect<void>;
}

export interface ScriptShopQuantityOptions {
  /**
   * The quantity to buy, validate, or sell.
   * @defaultValue 1
   */
  readonly quantity?: number;
}

export interface ScriptShopsApi {
  readonly buy: (
    query: ShopItemQuery,
    options?: ScriptShopQuantityOptions,
  ) => Effect.Effect<boolean>;
  readonly canBuy: (
    query: ShopItemQuery,
    options?: ScriptShopQuantityOptions,
  ) => Effect.Effect<boolean>;
  readonly close: (shopId?: number) => Effect.Effect<boolean>;
  readonly enhanceItem: (
    item: ItemQuery,
    options: ScriptEnhanceItemOptions,
  ) => Effect.Effect<boolean>;
  readonly get: (query: ShopItemQuery) => Effect.Effect<LiveItem | null>;
  readonly getAll: () => Effect.Effect<readonly LiveItem[]>;
  readonly getCurrent: () => Effect.Effect<LiveShop | null>;
  readonly getMaxBuyQuantity: (query: ShopItemQuery) => Effect.Effect<number>;
  readonly isMergeShop: () => Effect.Effect<boolean>;
  readonly isOpen: (shopId?: number) => Effect.Effect<boolean>;
  readonly load: (shopId: number) => Effect.Effect<boolean>;
  readonly openArmorCustomize: () => Effect.Effect<void>;
  readonly openHairShop: (shopId: number) => Effect.Effect<void>;
  readonly sell: (
    query: ItemQuery,
    options?: ScriptShopQuantityOptions,
  ) => Effect.Effect<boolean>;
}

export interface ScriptTempInventoryApi {
  /** @param quantity The minimum quantity required. */
  readonly contains: (
    query: ItemQuery,
    /** @defaultValue 1 */
    quantity?: number,
  ) => Effect.Effect<boolean>;
  readonly get: (query: ItemQuery) => Effect.Effect<LiveItem | null>;
  readonly getAll: () => Effect.Effect<readonly LiveItem[]>;
}

export interface ScriptWaitApi {
  /** @param options Polling options or a timeout value. */
  readonly forGameAction: (
    action: GameAction,
    /** @defaultValue { interval: "100 millis", timeout: "2 seconds" } */
    options?: WaitOptions | Duration.Input,
  ) => Effect.Effect<boolean>;
  readonly isGameActionAvailable: (
    action: GameAction,
  ) => Effect.Effect<boolean>;
  /** @param options Polling options. */
  readonly until: (
    condition: Effect.Effect<boolean>,
    /** @defaultValue { interval: "100 millis", timeout: undefined } */
    options?: WaitOptions,
  ) => Effect.Effect<boolean>;
  /** @param options Polling options. */
  readonly untilSome: <A>(
    condition: Effect.Effect<Option.Option<A>>,
    /** @defaultValue { interval: "100 millis", timeout: undefined } */
    options?: WaitOptions,
  ) => Effect.Effect<A | null>;
}

/** Controls automatic login recovery. */
export interface ScriptAutoReloginApi {
  readonly getDelayMs: () => Effect.Effect<number>;
  readonly getServer: () => Effect.Effect<string | undefined>;
  readonly getState: () => Effect.Effect<AutoReloginState>;
  readonly isEnabled: () => Effect.Effect<boolean>;
  readonly runLogin: (
    request: AutoReloginLoginRequest,
  ) => Effect.Effect<AutoReloginLoginResult, AutoReloginLoginError>;
  readonly setDelay: (delay: Duration.Input) => Effect.Effect<AutoReloginState>;
  readonly setEnabled: (enabled: boolean) => Effect.Effect<AutoReloginState>;
  readonly setServer: (
    server: string | undefined,
  ) => Effect.Effect<AutoReloginState>;
}

/** Controls automatic movement for supported encounter zones. */
export interface ScriptAutoZoneApi {
  readonly getMap: () => Effect.Effect<AutoZoneSupportedMap | undefined>;
  readonly getState: () => Effect.Effect<AutoZoneState>;
  readonly isEnabled: () => Effect.Effect<boolean>;
  readonly setEnabled: (enabled: boolean) => Effect.Effect<AutoZoneState>;
  readonly setMap: (
    map: AutoZoneSupportedMap | undefined,
  ) => Effect.Effect<AutoZoneState>;
}

export interface ScriptApi {
  readonly army: ScriptArmyApi;
  readonly auth: ScriptAuthApi;
  readonly bank: ScriptBankApi;
  readonly combat: ScriptCombatApi;
  readonly drops: ScriptDropsApi;
  readonly environment: ScriptEnvironmentApi;
  readonly events: ScriptEventsApi;
  readonly house: ScriptHouseApi;
  readonly inventory: ScriptInventoryApi;
  readonly map: ScriptMapApi;
  readonly monsters: ScriptMonstersApi;
  readonly packet: ScriptPacketApi;
  readonly player: ScriptPlayerApi;
  readonly players: ScriptPlayersApi;
  readonly quests: ScriptQuestsApi;
  readonly recipes: ScriptRecipesApi;
  readonly settings: ScriptSettingsApi;
  readonly shops: ScriptShopsApi;
  readonly tempInventory: ScriptTempInventoryApi;
  readonly wait: ScriptWaitApi;
}

export interface ScriptInputsApi {
  readonly get: (key: string) => Effect.Effect<ScriptInputValue | undefined>;
  readonly getAll: () => Effect.Effect<ScriptInputValues>;
}

export interface ScriptRuntimeOptions {
  readonly restartAfterReconnect: boolean;
  readonly roomPolicy: RoomPolicy;
  readonly safeStartStop: boolean;
}

/** Actions performed when a script exits. */
export interface ScriptExitOptions {
  /** Closes this game client. In a tabbed window, closes only its tab. */
  readonly closeClient?: boolean;
  readonly logout?: boolean;
}

export interface ScriptOptionsApi {
  readonly getAll: () => Effect.Effect<ScriptRuntimeOptions>;
  readonly getRestartAfterReconnect: () => Effect.Effect<boolean>;
  readonly getRoomPolicy: () => Effect.Effect<RoomPolicy>;
  readonly getSafeStartStop: () => Effect.Effect<boolean>;
  readonly reset: () => Effect.Effect<ScriptRuntimeOptions>;
  readonly setRestartAfterReconnect: (
    enabled: boolean,
  ) => Effect.Effect<ScriptRuntimeOptions>;
  readonly setRoomPolicy: (
    policy: RoomPolicy,
  ) => Effect.Effect<ScriptRuntimeOptions, ScriptExecutionError>;
  readonly setSafeStartStop: (
    enabled: boolean,
  ) => Effect.Effect<ScriptRuntimeOptions>;
}

export interface ScriptRuntimeApi {
  readonly signal: AbortSignal;
  /** @param times Number of repetitions. */
  readonly beep: (
    /** @defaultValue 1 */
    times?: number,
  ) => Effect.Effect<void, ScriptExecutionError>;
  readonly inputs: ScriptInputsApi;
  readonly options: ScriptOptionsApi;
  /**
   * Exits the current script and prevents later queued scripts from running.
   * Use this as an explicit escape hatch.
   *
   * @param options Exit actions.
   */
  readonly exit: (
    /** @defaultValue { closeClient: false, logout: false } */
    options?: ScriptExitOptions,
  ) => Effect.Effect<never, ScriptStopSignal>;
  readonly log: (message: unknown) => Effect.Effect<void>;
  readonly sleep: (
    duration: Duration.Input,
  ) => Effect.Effect<void, ScriptExecutionError>;
  /**
   * Stops the current script. If it is part of a queue, the next script runs.
   *
   * @param reason Stop message.
   */
  readonly stop: (
    /** @defaultValue "Script stopped." */
    reason?: string,
  ) => Effect.Effect<never, ScriptStopSignal>;
}

export interface ScriptEffectStd {
  readonly Duration: typeof Duration;
  readonly Effect: typeof Effect;
  readonly Option: typeof Option;
  readonly pipe: typeof pipe;
}

export type ScriptMain = () => ScriptGenerator<unknown>;

export interface ScriptModuleExports extends ScriptMain {
  readonly inputs?: ScriptInputsDefinition;
}
