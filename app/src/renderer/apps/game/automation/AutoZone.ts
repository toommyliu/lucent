import * as Effect from "effect/Effect";
import * as FiberMap from "effect/FiberMap";
import * as Random from "effect/Random";
import * as Schema from "effect/Schema";
import * as SubscriptionRef from "effect/SubscriptionRef";
import type * as FiberMapType from "effect/FiberMap";

import type { ApiService } from "../flash/api/Api";

export const AutoZoneSupportedMap = Schema.Literals([
  "ledgermayne",
  "moreskulls",
  "ultradage",
  "darkcarnax",
  "astralshrine",
  "queeniona",
  "magnumopus",
]);
export type AutoZoneSupportedMap = typeof AutoZoneSupportedMap.Type;

export const AUTO_ZONE_MAP_OPTIONS = [
  { value: "ledgermayne", label: "Ledgermayne" },
  { value: "moreskulls", label: "More Skulls" },
  { value: "ultradage", label: "Ultra Dage" },
  { value: "darkcarnax", label: "Dark Carnax" },
  { value: "astralshrine", label: "Astral Shrine" },
  { value: "queeniona", label: "Queen Iona" },
  { value: "magnumopus", label: "Magnum Opus" },
] as const;

export interface AutoZoneState {
  readonly enabled: boolean;
  readonly map: AutoZoneSupportedMap | undefined;
}

const snapshotState = (state: AutoZoneState): AutoZoneState => ({ ...state });

type Range = readonly [
  readonly [minimum: number, maximum: number],
  readonly [minimum: number, maximum: number],
];
type Target =
  | { readonly kind: "point"; readonly x: number; readonly y: number }
  | { readonly kind: "range"; readonly range: Range };

const zones: Partial<Record<AutoZoneSupportedMap, Record<string, Range>>> = {
  astralshrine: {
    "": [
      [461, 465],
      [320, 325],
    ],
    A: [
      [643, 708],
      [445, 447],
    ],
    B: [
      [199, 287],
      [181, 205],
    ],
  },
  darkcarnax: {
    "": [
      [480, 530],
      [419, 432],
    ],
    A: [
      [731, 850],
      [431, 432],
    ],
    B: [
      [54, 155],
      [431, 432],
    ],
  },
  ledgermayne: {
    "": [
      [431, 547],
      [234, 239],
    ],
    A: [
      [147, 276],
      [353, 357],
    ],
    B: [
      [727, 852],
      [353, 356],
    ],
  },
  magnumopus: {
    "": [
      [466, 470],
      [344, 420],
    ],
    A: [
      [682, 813],
      [367, 384],
    ],
    B: [
      [170, 285],
      [377, 384],
    ],
  },
  moreskulls: {
    "": [
      [778, 806],
      [358, 361],
    ],
    A: [
      [696, 802],
      [445, 452],
    ],
    B: [
      [677, 766],
      [321, 324],
    ],
  },
  ultradage: {
    "": [
      [481, 483],
      [296, 300],
    ],
    A: [
      [49, 164],
      [406, 412],
    ],
    B: [
      [797, 900],
      [400, 402],
    ],
  },
};

const positiveCharges = ["Positive Charge", "Positive Charge?"] as const;
const negativeCharges = ["Negative Charge", "Negative Charge?"] as const;
const left: Range = [
  [111, 272],
  [369, 379],
];
const right: Range = [
  [746, 869],
  [369, 379],
];
const target = (
  map: AutoZoneSupportedMap,
  zone: string,
  charge: "negative" | "none" | "positive",
): Target | undefined => {
  if (map !== "queeniona") {
    const range = zones[map]?.[zone];
    return range === undefined ? undefined : { kind: "range", range };
  }
  if (zone !== "A" && zone !== "B") {
    return { kind: "point", x: 490, y: 320 };
  }
  const range =
    zone === "A"
      ? charge === "positive"
        ? right
        : charge === "negative"
          ? left
          : undefined
      : charge === "positive"
        ? left
        : charge === "negative"
          ? right
          : undefined;
  return range === undefined ? undefined : { kind: "range", range };
};

export const makeAutoZone = Effect.fnUntraced(function* (
  api: ApiService,
  fibers: FiberMapType.FiberMap<string>,
) {
  const state = yield* SubscriptionRef.make<AutoZoneState>({
    enabled: false,
    map: undefined,
  });
  const move = (destination: Target) =>
    destination.kind === "point"
      ? api.player.walkTo(destination)
      : Effect.all({
          x: Random.nextIntBetween(
            destination.range[0][0],
            destination.range[0][1],
          ),
          y: Random.nextIntBetween(
            destination.range[1][0],
            destination.range[1][1],
          ),
        }).pipe(
          Effect.flatMap((position) => api.player.walkTo(position)),
          Effect.asVoid,
        );

  const hasAura = (names: readonly string[]) =>
    Effect.forEach(names, (name) => api.player.auras.get(name)).pipe(
      Effect.map((auras) => auras.some((aura) => aura !== null)),
    );
  const transition = (map: AutoZoneSupportedMap, zone: string) =>
    Effect.gen(function* () {
      if (map === "queeniona") yield* Effect.sleep("500 millis");
      const current = yield* SubscriptionRef.get(state);
      const activeMap = yield* api.map.getName();
      if (
        !current.enabled ||
        current.map !== map ||
        activeMap.localeCompare(map, undefined, { sensitivity: "accent" }) !== 0
      ) {
        return;
      }
      const positive =
        map === "queeniona" ? yield* hasAura(positiveCharges) : false;
      const negative =
        map === "queeniona" && !positive
          ? yield* hasAura(negativeCharges)
          : false;
      const destination = target(
        map,
        zone,
        positive ? "positive" : negative ? "negative" : "none",
      );
      if (destination !== undefined) yield* move(destination);
    });

  const dispose = yield* api.events.on({ type: "zone" }, (event) => {
    if (event.type !== "zone") return Effect.void;
    return SubscriptionRef.get(state).pipe(
      Effect.flatMap((current) =>
        current.enabled && current.map === event.map
          ? FiberMap.run(
              fibers,
              "auto-zone-transition",
              transition(current.map, event.zone),
            ).pipe(Effect.asVoid)
          : Effect.void,
      ),
    );
  });
  yield* Effect.addFinalizer(() => Effect.sync(dispose));

  const changes = SubscriptionRef.changes(state);

  const getMap = () =>
    SubscriptionRef.get(state).pipe(Effect.map((current) => current.map));

  const getState = () =>
    SubscriptionRef.get(state).pipe(Effect.map(snapshotState));

  const isEnabled = () =>
    SubscriptionRef.get(state).pipe(Effect.map((current) => current.enabled));

  const setEnabled = (enabled: boolean) =>
    SubscriptionRef.updateAndGet(state, (current) => ({
      ...current,
      enabled,
    })).pipe(Effect.map(snapshotState));

  const setMap = (map: AutoZoneSupportedMap | undefined) => {
    return FiberMap.remove(fibers, "auto-zone-transition").pipe(
      Effect.andThen(
        SubscriptionRef.updateAndGet(state, (current) => ({
          ...current,
          map,
        })).pipe(Effect.map(snapshotState)),
      ),
    );
  };

  return {
    changes,
    getMap,
    getState,
    isEnabled,
    setEnabled,
    setMap,
  };
});

export type AutoZone = Effect.Success<ReturnType<typeof makeAutoZone>>;
