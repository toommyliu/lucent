import type { ItemSnapshot } from "@lucent/game";

export type RuntimeEvent =
  | { readonly type: "connection"; readonly status: string }
  | { readonly type: "debug"; readonly message: string };

export type ProjectionEvent =
  | {
      readonly afk: boolean;
      readonly entityId: number;
      readonly type: "player-afk";
      readonly username: string;
    }
  | {
      readonly type: "join-map";
      readonly map: {
        readonly id: number;
        readonly name: string;
        readonly roomNumber: number;
      };
    }
  | {
      readonly type: "item-drop";
      readonly item: ItemSnapshot;
    }
  | { readonly type: "quest-complete"; readonly questId: number }
  | { readonly type: "monster-death"; readonly monsterMapId: number }
  | { readonly type: "monster-respawn"; readonly monsterMapId: number }
  | {
      readonly type: "player-death";
      readonly entityId: number;
      readonly username: string;
    }
  | { readonly type: "players-changed" }
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
      readonly durationMs?: number;
      readonly monsterMapId: number;
      readonly source: "aura" | "message";
      readonly triggerId: string;
      readonly triggerText: string;
      readonly type: "counter-attack-start";
    }
  | {
      readonly monsterMapId: number;
      readonly source: "aura" | "message";
      readonly triggerId: string;
      readonly triggerText: string;
      readonly type: "counter-attack-end";
    }
  | ({
      readonly cell: string;
      readonly entityId: number;
      readonly pad: string;
      /** The latest coordinate projected for the player. */
      readonly position: {
        readonly x: number;
        readonly y: number;
      };
      readonly type: "player-location";
      readonly username: string;
    } & (
      | {
          /** The endpoint reported by a complete `tx`/`ty` movement. */
          readonly destination: {
            readonly x: number;
            readonly y: number;
          };
          readonly kind: "walk";
        }
      | {
          /** `position` reports coordinates; `cell` reports only cell/pad. */
          readonly kind: "cell" | "position";
        }
    ))
  | {
      readonly type: "update-message";
      readonly message: string;
      readonly monsterMapId?: number;
      readonly source: "animation" | "aura";
    }
  | { readonly type: "zone"; readonly map: string; readonly zone: string };

export type Event = RuntimeEvent | ProjectionEvent;
export type EventType = Event["type"];

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
      readonly afk?: boolean;
      readonly entityId?: number;
      readonly type: "player-afk";
      readonly username?: string;
    }
  | {
      readonly type: "join-map";
    }
  | {
      readonly type: "item-drop";
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
      readonly type: "player-death";
      readonly username?: string;
    }
  | {
      readonly entityId?: number;
      readonly kind?: "cell" | "position" | "walk";
      readonly type: "player-location";
      readonly username?: string;
    }
  | {
      readonly type: "players-changed";
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
      readonly durationMs?: number;
      readonly monsterMapId?: number;
      readonly source?: "aura" | "message";
      readonly triggerId?: string;
      readonly triggerText?: string;
      readonly type: "counter-attack-start";
    }
  | {
      readonly monsterMapId?: number;
      readonly source?: "aura" | "message";
      readonly triggerId?: string;
      readonly triggerText?: string;
      readonly type: "counter-attack-end";
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

export type EventForSelector<S extends EventSelector | undefined> = S extends {
  readonly type: infer T extends EventType;
}
  ? EventForType<T>
  : Event;

export type EventForType<T extends EventType> = Extract<
  Event,
  { readonly type: T }
>;

export type EventSelectorForType<T extends EventType> = EventSelector & {
  readonly type: T;
};

type Scalar = boolean | number | string;

const isScalar = (value: unknown): value is Scalar =>
  typeof value === "boolean" ||
  typeof value === "number" ||
  typeof value === "string";

export const matchesEvent = <S extends EventSelector | undefined>(
  event: Event,
  selector: S,
): event is EventForSelector<S> => {
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
