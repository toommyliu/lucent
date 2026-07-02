import {
  Context,
  Effect,
  Layer,
  Random,
  Schema,
  SynchronizedRef,
} from "effect";

import { PlayerApi } from "../api/Player";
import { EventsApi } from "../api/Events";
import { equalsIgnoreCase } from "../payload";
import { WorldState } from "../state/World";
import {
  makeStateListeners,
  type StateDisposer,
  type StateSubscriptionOptions,
} from "../StateListeners";

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
] as const satisfies readonly {
  readonly label: string;
  readonly value: AutoZoneSupportedMap;
}[];

export interface AutoZoneState {
  readonly enabled: boolean;
  readonly map: AutoZoneSupportedMap | undefined;
}

export interface AutoZoneShape {
  readonly getMap: Effect.Effect<AutoZoneSupportedMap | undefined>;
  readonly getState: Effect.Effect<AutoZoneState>;
  readonly isEnabled: Effect.Effect<boolean>;
  readonly onState: (
    listener: (state: AutoZoneState) => void,
    options?: StateSubscriptionOptions,
  ) => Effect.Effect<StateDisposer>;
  readonly setEnabled: (enabled: boolean) => Effect.Effect<AutoZoneState>;
  readonly setMap: (
    map: AutoZoneSupportedMap | undefined,
  ) => Effect.Effect<AutoZoneState>;
}

export class AutoZone extends Context.Service<AutoZone, AutoZoneShape>()(
  "lucent/game/flash/features/AutoZone",
) {}

type CoordinateRange = readonly [
  readonly [min: number, max: number],
  readonly [min: number, max: number],
];

type ZoneMap = Partial<Record<string, CoordinateRange>>;

interface AutoZoneRuntimeState {
  enabled: boolean;
  map: AutoZoneSupportedMap | undefined;
  queenionaSequence: number;
}

const AUTO_ZONES: Partial<Record<AutoZoneSupportedMap, ZoneMap>> = {
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

const QUEENIONA_MAP = "queeniona" satisfies AutoZoneSupportedMap;
const QUEENIONA_AURA_SETTLE_DELAY = "500 millis";
const QUEENIONA_CENTER = [490, 320] as const;
const QUEENIONA_LEFT: CoordinateRange = [
  [111, 272],
  [369, 379],
];
const QUEENIONA_RIGHT: CoordinateRange = [
  [746, 869],
  [369, 379],
];
const QUEENIONA_POSITIVE_CHARGES = [
  "Positive Charge",
  "Positive Charge?",
] as const;
const QUEENIONA_NEGATIVE_CHARGES = [
  "Negative Charge",
  "Negative Charge?",
] as const;

const initialState = (): AutoZoneRuntimeState => ({
  enabled: false,
  map: undefined,
  queenionaSequence: 0,
});

const publicState = (state: AutoZoneRuntimeState): AutoZoneState => ({
  enabled: state.enabled,
  map: state.map,
});

const randomPosition = ([[x0, x1], [y0, y1]]: CoordinateRange) =>
  Effect.all({
    x: Random.nextIntBetween(x0, x1),
    y: Random.nextIntBetween(y0, y1),
  });

export const layer = Layer.effect(
  AutoZone,
  Effect.gen(function* () {
    const events = yield* EventsApi;
    const player = yield* PlayerApi;
    const world = yield* WorldState;
    const ref = yield* SynchronizedRef.make(initialState());
    const listeners = makeStateListeners<AutoZoneState>("autozone");

    const getState = SynchronizedRef.get(ref).pipe(Effect.map(publicState));

    const updateState = (
      update: (state: AutoZoneRuntimeState) => void,
    ): Effect.Effect<AutoZoneState> =>
      Effect.gen(function* () {
        const state = yield* SynchronizedRef.modify(ref, (current) => {
          update(current);
          return [publicState(current), current] as const;
        });
        yield* listeners.emit(state);
        return state;
      });

    const walkTo = (x: number, y: number) =>
      player.walkTo(x, y).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning({
            cause,
            message: "autozone walk failed",
          }),
        ),
      );

    const walkToRandomPosition = (range: CoordinateRange) =>
      Effect.gen(function* () {
        const position = yield* randomPosition(range);
        yield* walkTo(position.x, position.y);
      });

    const fallbackHasProjectedPlayerAura = (auraNames: readonly string[]) =>
      Effect.gen(function* () {
        const self = yield* world.getMe;
        if (self !== null && self.entityId !== 0) {
          return false;
        }

        const targets = new Set<number>();
        for (const auraName of auraNames) {
          for (const target of yield* world.getPlayerAuraTargetsByName(
            auraName,
          )) {
            targets.add(target);
          }
        }

        return targets.size === 1;
      });

    const hasSelfAura = (auraNames: readonly string[]) =>
      Effect.gen(function* () {
        for (const auraName of auraNames) {
          const hasAura = yield* player.auras.has(auraName);
          if (hasAura) {
            return true;
          }
        }

        return yield* fallbackHasProjectedPlayerAura(auraNames);
      });

    const isCurrentQueenionaSequence = (sequence: number) =>
      Effect.gen(function* () {
        const state = yield* SynchronizedRef.get(ref);
        if (
          !state.enabled ||
          state.map !== QUEENIONA_MAP ||
          state.queenionaSequence !== sequence
        ) {
          return false;
        }

        const map = yield* world.getMap;
        return equalsIgnoreCase(map.name, QUEENIONA_MAP);
      });

    const handleQueenionaZone = (zone: string, sequence: number) =>
      Effect.gen(function* () {
        yield* Effect.sleep(QUEENIONA_AURA_SETTLE_DELAY);

        if (!(yield* isCurrentQueenionaSequence(sequence))) {
          return;
        }

        if (zone !== "A" && zone !== "B") {
          yield* walkTo(QUEENIONA_CENTER[0], QUEENIONA_CENTER[1]);
          return;
        }

        const positiveCharge = yield* hasSelfAura(QUEENIONA_POSITIVE_CHARGES);
        const negativeCharge = positiveCharge
          ? false
          : yield* hasSelfAura(QUEENIONA_NEGATIVE_CHARGES);

        const targetRange =
          zone === "A"
            ? positiveCharge
              ? QUEENIONA_RIGHT
              : negativeCharge
                ? QUEENIONA_LEFT
                : undefined
            : positiveCharge
              ? QUEENIONA_LEFT
              : negativeCharge
                ? QUEENIONA_RIGHT
                : undefined;

        if (targetRange !== undefined) {
          yield* walkToRandomPosition(targetRange);
        }
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logError({
            cause,
            message: "queeniona autozone failed",
          }),
        ),
      );

    const disposeZone = yield* events.on({ type: "zone" }, (event) =>
      Effect.gen(function* () {
        if (event.type !== "zone") {
          return;
        }

        const state = yield* SynchronizedRef.get(ref);
        if (
          !state.enabled ||
          state.map === undefined ||
          !equalsIgnoreCase(event.payload.map, state.map)
        ) {
          return;
        }

        if (state.map === QUEENIONA_MAP) {
          const sequence = yield* SynchronizedRef.modify(ref, (current) => {
            current.queenionaSequence += 1;
            return [current.queenionaSequence, current] as const;
          });
          yield* handleQueenionaZone(event.payload.zone, sequence).pipe(
            Effect.forkDetach,
          );
          return;
        }

        const zoneRange = AUTO_ZONES[state.map]?.[event.payload.zone];
        if (zoneRange !== undefined) {
          yield* walkToRandomPosition(zoneRange);
        }
      }),
    );
    yield* Effect.addFinalizer(() => Effect.sync(disposeZone));

    return AutoZone.of({
      getMap: getState.pipe(Effect.map((state) => state.map)),
      getState,
      isEnabled: getState.pipe(Effect.map((state) => state.enabled)),
      onState: (listener, options) => listeners.on(getState, listener, options),
      setEnabled: (enabled) =>
        updateState((state) => {
          state.enabled = enabled;
          if (!enabled) {
            state.queenionaSequence += 1;
          }
        }),
      setMap: (map) =>
        updateState((state) => {
          state.map = map;
          state.queenionaSequence += 1;
        }),
    });
  }),
);
