import type { Packet } from "./Packet";

export type RuntimeEvent =
  | { readonly type: "connection"; readonly status: string }
  | { readonly type: "debug"; readonly message: string };

export type ProtocolEvent = {
  readonly type: "packet";
  readonly packet: Packet;
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

/**
 * An event-shaped partial selector. `type` chooses the event variant, and every
 * other field is an exact-match constraint on a scalar field of that variant.
 *
 * Omitting a field leaves it unconstrained. With exact optional property types,
 * explicitly passing `undefined` is invalid; untyped callers that do so safely
 * fail to match instead of selecting events where the field happens to be
 * absent.
 */
export type EventSelector =
  | {
      readonly status?: string;
      readonly type: "connection";
    }
  | {
      readonly message?: string;
      readonly type: "debug";
    }
  | {
      readonly type: "packet";
    }
  | {
      readonly type: "join-map";
    }
  | {
      readonly questId?: number;
      readonly type: "quest-complete";
    }
  | {
      readonly monsterMapId?: number;
      readonly type: "monster-death" | "monster-respawn";
    }
  | {
      readonly entityId?: number;
      readonly type: "player-death" | "player-location";
      readonly username?: string;
    }
  | {
      readonly duration?: number;
      readonly icon?: string;
      readonly name?: string;
      readonly sourceId?: number;
      readonly sourceType?: "monster" | "player";
      readonly targetId?: number;
      readonly targetType?: "monster" | "player";
      readonly type: "aura-added" | "aura-removed";
    }
  | {
      readonly message?: string;
      readonly monsterMapId?: number;
      readonly source?: "animation" | "aura";
      readonly type: "update-message";
    }
  | {
      readonly map?: string;
      readonly type: "zone";
      readonly zone?: string;
    };

type Scalar = boolean | number | string;

const isScalar = (value: unknown): value is Scalar =>
  typeof value === "boolean" ||
  typeof value === "number" ||
  typeof value === "string";

export const matchesEvent = (
  event: Event,
  selector: EventSelector | undefined,
): boolean => {
  if (selector === undefined) return true;
  if (
    selector === null ||
    typeof selector !== "object" ||
    Array.isArray(selector)
  ) {
    return false;
  }

  const fields = Object.entries(selector);
  if (!fields.some(([key]) => key === "type")) return false;

  const record: Readonly<Record<string, unknown>> = event;
  return fields.every(
    ([key, value]) => isScalar(value) && record[key] === value,
  );
};
