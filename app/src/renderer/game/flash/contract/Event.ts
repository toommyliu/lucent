import type { Packet, PacketDirection } from "./Packet";

export type RuntimeEvent =
  | { readonly type: "connection"; readonly status: string }
  | { readonly type: "debug"; readonly message: string };

export type ProtocolEvent =
  | { readonly type: "packet"; readonly packet: Packet }
  | {
      readonly type: "packet-decode-failed";
      readonly direction: PacketDirection;
      readonly raw: string;
    };

export type ProjectionEvent =
  | {
      readonly type: "join-map";
      readonly map: {
        readonly id: number;
        readonly name: string;
        readonly roomNumber: number;
      };
    }
  | { readonly type: "quest-complete"; readonly questId: number }
  | { readonly type: "monster-death"; readonly monsterMapId: number }
  | { readonly type: "monster-respawn"; readonly monsterMapId: number }
  | {
      readonly type: "player-death";
      readonly entityId: number;
      readonly username: string;
    }
  | {
      readonly type: "aura-added";
      readonly duration?: number;
      readonly icon?: string;
      readonly name: string;
      readonly sourceId?: number;
      readonly sourceType?: "monster" | "player";
      readonly targetId: number;
      readonly targetType: "monster" | "player";
    }
  | {
      readonly type: "aura-removed";
      readonly duration?: number;
      readonly icon?: string;
      readonly name: string;
      readonly sourceId?: number;
      readonly sourceType?: "monster" | "player";
      readonly targetId: number;
      readonly targetType: "monster" | "player";
    }
  | {
      readonly type: "combat-action-result";
      readonly actionId: number;
      readonly iRes: number;
      readonly monsterMapId?: number;
      readonly sourceId: number;
      readonly sourceType: "monster" | "player";
      readonly success: boolean;
      readonly targetId?: number;
      readonly targetType?: "monster" | "player";
    }
  | {
      readonly type: "player-location";
      readonly entityId: number;
      readonly username: string;
    }
  | {
      readonly type: "update-message";
      readonly message: string;
      readonly monsterMapId?: number;
      readonly source: "animation" | "aura";
    }
  | { readonly type: "zone"; readonly map: string; readonly zone: string };

export type Event = RuntimeEvent | ProtocolEvent | ProjectionEvent;

export interface EventSelector {
  readonly actionId?: number;
  readonly monsterMapId?: number;
  readonly questId?: number;
  readonly sourceId?: number;
  readonly sourceType?: "monster" | "player";
  readonly type?: Event["type"];
}

const monsterMapId = (event: Event): number | undefined => {
  switch (event.type) {
    case "monster-death":
    case "monster-respawn":
    case "update-message":
      return event.monsterMapId;
    case "aura-added":
    case "aura-removed":
      return event.targetType === "monster" ? event.targetId : undefined;
    case "combat-action-result":
      return (
        event.monsterMapId ??
        (event.targetType === "monster" ? event.targetId : undefined)
      );
    default:
      return undefined;
  }
};

export const matchesEvent = (
  event: Event,
  selector: EventSelector | undefined,
): boolean =>
  (selector?.type === undefined || selector.type === event.type) &&
  (selector?.monsterMapId === undefined ||
    monsterMapId(event) === selector.monsterMapId) &&
  (selector?.actionId === undefined ||
    (event.type === "combat-action-result" &&
      event.actionId === selector.actionId)) &&
  (selector?.sourceId === undefined ||
    (event.type === "combat-action-result" &&
      event.sourceId === selector.sourceId)) &&
  (selector?.sourceType === undefined ||
    (event.type === "combat-action-result" &&
      event.sourceType === selector.sourceType)) &&
  (selector?.questId === undefined ||
    (event.type === "quest-complete" && event.questId === selector.questId));
