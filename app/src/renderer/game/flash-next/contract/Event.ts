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

export type Event = RuntimeEvent | ProtocolEvent;

export interface EventSelector {
  readonly type?: Event["type"];
}

export const matchesEvent = (
  event: Event,
  selector: EventSelector | undefined,
): boolean => selector?.type === undefined || selector.type === event.type;
