import type { Packet, PacketDirection } from "./Packet";

export type RuntimeEvent =
  | { readonly type: "loaded" }
  | { readonly type: "connection"; readonly status: string }
  | { readonly type: "debug"; readonly message: string }
  | { readonly type: "progress"; readonly percent: number };

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
  | {
      readonly type: "player-death";
      readonly entityId: number;
      readonly username: string;
    }
  | {
      readonly type: "aura-added";
      readonly name: string;
      readonly targetId: number;
      readonly targetType: "monster" | "player";
    }
  | {
      readonly type: "aura-removed";
      readonly name: string;
      readonly targetId: number;
      readonly targetType: "monster" | "player";
    };

export type Event = RuntimeEvent | ProtocolEvent | ProjectionEvent;

export interface EventSelector {
  readonly type?: Event["type"];
}

export const matchesEvent = (
  event: Event,
  selector: EventSelector | undefined,
): boolean => selector?.type === undefined || selector.type === event.type;
