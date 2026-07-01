import { Schema } from "effect";
import type { Duration } from "effect";

import type * as BridgeTypes from "../Types";

export type {
  ConnectToSelectionFailureReason,
  ConnectToSelectionResult,
  ConnectToSelectionStatus,
  ConsumableSkillItem,
  InventoryItemSelector,
  TargetInfo,
} from "../Types";

export type UnknownRecord = Record<string, unknown>;

export type ItemSelector = BridgeTypes.InventoryItemSelector | number | string;

export type MonsterSelector = BridgeTypes.MonsterSelector | number | string;

export type ShopItemSelector =
  | BridgeTypes.ShopItemSelector
  | BridgeTypes.InventoryItemSelector
  | number
  | string;

export interface ItemRecord {
  readonly banked: boolean;
  readonly category: string;
  readonly charItemId?: number;
  readonly coins: boolean;
  readonly cost: number;
  readonly description: string;
  readonly enhancement?: {
    readonly dps?: number;
    readonly id?: number;
    readonly level?: number;
    readonly patternId?: number;
    readonly range?: number;
    readonly rarity?: number;
  };
  readonly equipped: boolean;
  readonly equipmentSlot: string;
  readonly file: string;
  readonly house: boolean;
  readonly itemId: number;
  readonly link: string;
  readonly meta: string;
  readonly name: string;
  readonly quantity: number;
  readonly temp: boolean;
  readonly virtual: boolean;
}

export interface DropRecord extends ItemRecord {
  readonly dropId: number;
  readonly dropQuantity: number;
}

export interface ShopInfoRecord {
  readonly house: boolean;
  readonly id: number;
  readonly items: readonly ShopItemRecord[];
  readonly limited: boolean;
  readonly merge: boolean;
  readonly name: string;
}

export interface ShopItemRecord extends ItemRecord {
  readonly shopItemId?: number | string;
}

export interface QuestRecord {
  readonly id: number;
  readonly name: string;
  readonly raw: UnknownRecord;
}

export interface FactionRecord {
  readonly id: number;
  readonly name: string;
  readonly rank: number;
  readonly reputation: number;
}

export interface OutfitRecord {
  readonly name: string;
  readonly raw: UnknownRecord;
}

export interface ServerRecord {
  readonly chat: number;
  readonly count: number;
  readonly language: string;
  readonly max: number;
  readonly memberOnly: boolean;
  readonly name: string;
  readonly online: boolean;
  readonly raw: UnknownRecord;
}

export interface AuraRecord {
  readonly category?: string;
  readonly duration: number;
  readonly icon?: string;
  readonly name: string;
  readonly stack: number;
  readonly value?: number;
}

export interface PlayerRecord {
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
  readonly position: readonly [number, number];
  readonly state: number;
  readonly username: string;
}

export interface MonsterRecord {
  readonly cell: string;
  readonly hp: number;
  readonly level: number;
  readonly maxHp: number;
  readonly maxMp: number;
  readonly monsterId: number;
  readonly monsterMapId: number;
  readonly mp: number;
  readonly name: string;
  readonly race: string;
  readonly state: number;
}

export interface MapRecord {
  readonly id: number;
  readonly name: string;
  readonly roomNumber: number;
}

export interface Position {
  readonly x: number;
  readonly y: number;
}

export interface FlashSettingsSnapshot {
  readonly animationsEnabled: boolean;
  readonly antiCounterEnabled: boolean;
  readonly collisionsEnabled: boolean;
  readonly customGuild: string;
  readonly customName: string;
  readonly deathAdsVisible: boolean;
  readonly enemyMagnetEnabled: boolean;
  readonly frameRate: number;
  readonly infiniteRangeEnabled: boolean;
  readonly lagKillerEnabled: boolean;
  readonly otherPlayersVisible: boolean;
  readonly provokeCellEnabled: boolean;
  readonly skipCutscenesEnabled: boolean;
  readonly walkSpeed: number;
}

export const FlashPacketDirectionSchema = Schema.Literals([
  "client",
  "server",
  "extension",
]);

export type FlashPacketDirection = typeof FlashPacketDirectionSchema.Type;

export const FlashPacketWireTypeSchema = Schema.Literals([
  "str",
  "json",
  "xml",
  "unknown",
]);

export type FlashPacketWireType = typeof FlashPacketWireTypeSchema.Type;

export const ClientPacketSchema = Schema.Struct({
  command: Schema.String,
  direction: Schema.Literal("client"),
  params: Schema.Array(Schema.String),
  raw: Schema.String,
  wireType: FlashPacketWireTypeSchema,
});

export type ClientPacket = typeof ClientPacketSchema.Type;

export const ServerPacketSchema = Schema.Struct({
  command: Schema.String,
  data: Schema.Unknown,
  direction: Schema.Literal("server"),
  raw: Schema.String,
  wireType: FlashPacketWireTypeSchema,
});

export type ServerPacket = typeof ServerPacketSchema.Type;

export const ExtensionPacketSchema = Schema.Struct({
  command: Schema.String,
  data: Schema.Unknown,
  direction: Schema.Literal("extension"),
  raw: Schema.String,
  wireType: FlashPacketWireTypeSchema,
});

export type ExtensionPacket = typeof ExtensionPacketSchema.Type;

export const FlashPacketSchema = Schema.Union([
  ClientPacketSchema,
  ServerPacketSchema,
  ExtensionPacketSchema,
]);

export type FlashPacket = typeof FlashPacketSchema.Type;

export interface PacketSelector {
  readonly command?: string;
  readonly direction?: FlashPacketDirection;
  readonly wireType?: FlashPacketWireType;
}

export type FlashEvent =
  | {
      readonly payload: { readonly status: string };
      readonly type: "connection";
    }
  | {
      readonly payload: { readonly message: string };
      readonly type: "debug";
    }
  | {
      readonly type: "loaded";
    }
  | {
      readonly payload: { readonly percent: number };
      readonly type: "progress";
    }
  | {
      readonly packet: FlashPacket;
      readonly payload: UnknownRecord;
      readonly type: "questComplete";
    }
  | {
      readonly packet: FlashPacket;
      readonly payload: MapRecord;
      readonly type: "joinMap";
    }
  | {
      readonly packet: FlashPacket;
      readonly payload: { readonly monsterMapId: number };
      readonly type: "monsterDeath";
    }
  | {
      readonly packet: FlashPacket;
      readonly payload: {
        readonly aura: AuraRecord;
        readonly targetId: number;
        readonly targetType: "monster" | "player";
      };
      readonly type: "auraAdded";
    }
  | {
      readonly packet: FlashPacket;
      readonly payload: {
        readonly auraName: string;
        readonly targetId: number;
        readonly targetType: "monster" | "player";
      };
      readonly type: "auraRemoved";
    };

export type FlashEventType = FlashEvent["type"];

export interface EventSelector {
  readonly type?: FlashEventType;
}

export interface WaitOptions {
  readonly interval?: Duration.Input;
  readonly timeout?: Duration.Input;
}

export type ClientPacketSendType = "str" | "json" | "xml";

export type ServerPacketSendType = "String" | "Json";

export interface AuthConnectOutcome {
  readonly message: string;
  readonly retryable: boolean;
  readonly serverName?: string;
  readonly status:
    | "blocked"
    | "connected"
    | "connection-error"
    | "connection-failed"
    | "full"
    | "not-found"
    | "not-ready"
    | "timeout";
}

export type Skill = number;

export interface CombatKillOptions {
  readonly findMost?: boolean;
  readonly killPriority?: readonly MonsterSelector[] | string;
  readonly maxKills?: number;
  readonly profile?: unknown;
  readonly skillDelay?: number;
  readonly skillSet?: readonly Skill[];
  readonly skillWait?: boolean;
  readonly timeout?: Duration.Input;
}

export interface HuntOptions {
  readonly findMost?: boolean;
}

export interface SkillUseOptions {
  readonly force?: boolean;
  readonly wait?: boolean;
}

export interface QuantityOptions {
  readonly quantity?: number;
}

export interface OutfitOptions {
  readonly keepColors?: boolean;
}
