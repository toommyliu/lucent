import { Schema } from "effect";
import type { Duration } from "effect";

import type {
  CombatProfile,
  CombatProfileDefinition,
} from "@lucent/core/combatProfiles";
import type {
  Aura,
  AuraKind,
  EntityState,
  ItemQuery,
  MonsterQuery,
  Position,
  ShopItemQuery,
} from "@lucent/game";

export type {
  Aura,
  AuraKind,
  AuraQueryOptions,
  Entity,
  EntityState,
  Faction,
  Item,
  ItemContext,
  Monster,
  Outfit,
  Player,
  Position,
  Quest,
  Server,
  Shop,
} from "@lucent/game";

export type {
  ConnectToSelectionFailureReason,
  ConnectToSelectionResult,
  ConnectToSelectionStatus,
  ConsumableSkillItem,
  InventoryItemSelector,
  TargetInfo,
} from "../Types";

export type UnknownRecord = Record<string, unknown>;

export interface MapInfo {
  readonly id: number;
  readonly name: string;
  readonly roomNumber: number;
}

export type ItemSelector = ItemQuery;

export type MonsterSelector = MonsterQuery;

export type ShopItemSelector = ShopItemQuery;

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

export type FlashSettingsPatch = {
  -readonly [Key in keyof FlashSettingsSnapshot]?: FlashSettingsSnapshot[Key];
};

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

export type FlashEventKind = "packet" | "projection" | "runtime";

export type FlashRuntimeEvent =
  | {
      readonly kind: "runtime";
      readonly payload: { readonly status: string };
      readonly type: "connection";
    }
  | {
      readonly kind: "runtime";
      readonly payload: { readonly message: string };
      readonly type: "debug";
    }
  | {
      readonly kind: "runtime";
      readonly type: "loaded";
    }
  | {
      readonly kind: "runtime";
      readonly payload: { readonly percent: number };
      readonly type: "progress";
    };

export type FlashPacketEvent =
  | {
      readonly kind: "packet";
      readonly payload: FlashPacket;
      readonly type: "packetReceived";
    }
  | {
      readonly kind: "packet";
      readonly payload: {
        readonly direction: FlashPacketDirection;
        readonly raw: string;
      };
      readonly type: "packetParseFailed";
    };

export type FlashProjectionEvent =
  | {
      readonly kind: "projection";
      readonly packet: FlashPacket;
      readonly payload: UnknownRecord;
      readonly type: "questComplete";
    }
  | {
      readonly kind: "projection";
      readonly packet: FlashPacket;
      readonly payload: MapInfo;
      readonly type: "joinMap";
    }
  | {
      readonly kind: "projection";
      readonly packet: FlashPacket;
      readonly payload: {
        readonly map: string;
        readonly zone: string;
      };
      readonly type: "zone";
    }
  | {
      readonly kind: "projection";
      readonly packet: FlashPacket;
      readonly payload: {
        readonly afk: boolean;
        readonly entityId?: number;
        readonly isSelf: boolean;
        readonly username: string;
      };
      readonly type: "playerAfk";
    }
  | {
      readonly kind: "projection";
      readonly packet: FlashPacket;
      readonly payload: {
        readonly cell?: string;
        readonly entityId?: number;
        readonly isSelf: boolean;
        readonly pad?: string;
        readonly position?: Position;
        readonly username: string;
      };
      readonly type: "playerLocation";
    }
  | {
      readonly kind: "projection";
      readonly packet: FlashPacket;
      readonly payload: { readonly monsterMapId: number };
      readonly type: "monsterDeath";
    }
  | {
      readonly kind: "projection";
      readonly packet: FlashPacket;
      readonly payload: {
        readonly aura: Aura;
        readonly auraKind: AuraKind;
        readonly targetId: number;
        readonly targetType: "monster" | "player";
      };
      readonly type: "auraAdded";
    }
  | {
      readonly kind: "projection";
      readonly packet: FlashPacket;
      readonly payload: {
        readonly auraName: string;
        readonly auraKind: AuraKind;
        readonly remainingStack: number;
        readonly targetId: number;
        readonly targetType: "monster" | "player";
      };
      readonly type: "auraRemoved";
    }
  | {
      readonly kind: "projection";
      readonly packet: FlashPacket;
      readonly payload: {
        readonly cell: string;
        readonly entityId: number;
        readonly hp: number;
        readonly isSelf: boolean;
        readonly pad: string;
        readonly state: EntityState;
        readonly username: string;
      };
      readonly type: "playerDeath";
    }
  | {
      readonly kind: "projection";
      readonly packet: FlashPacket;
      readonly payload: {
        readonly auraName?: string;
        readonly auraPhase?: "off" | "on";
        readonly message: string;
        readonly monMapId?: number;
        readonly source: "animation" | "aura";
        readonly sourceMonMapId?: number;
        readonly targetId?: number;
        readonly targetMonMapId?: number;
        readonly targetName?: string;
        readonly targetType?: "monster" | "player";
      };
      readonly type: "updateMessage";
    };

export type FlashEvent =
  | FlashPacketEvent
  | FlashProjectionEvent
  | FlashRuntimeEvent;

export type FlashEventType = FlashEvent["type"];

export interface EventSelector {
  readonly kind?: FlashEventKind;
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

export type Skill = number | string;

export type ScriptCombatProfileInput =
  | CombatProfile
  | CombatProfileDefinition
  | string;

export interface CombatKillOptions {
  readonly findMost?: boolean;
  readonly killPriority?: readonly MonsterSelector[] | string;
  readonly maxKills?: number;
  readonly profile?: ScriptCombatProfileInput;
  readonly skillDelay?: number;
  readonly skillSet?: readonly Skill[] | string;
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
