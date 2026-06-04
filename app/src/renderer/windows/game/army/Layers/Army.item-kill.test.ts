import { Effect, Layer, Option } from "effect";
import { expect, test } from "vitest";
import type {
  ArmyProgressPayload,
  ArmyProgressResult,
} from "../../../../../shared/army";
import type { ArmySession } from "../Services/Army";
import { Army } from "../Services/Army";
import { Auth, type AuthShape } from "../../flash/Services/Auth";
import { Combat, type CombatKillOptions } from "../../flash/Services/Combat";
import type { CombatShape } from "../../flash/Services/Combat";
import { Drops, type DropsShape } from "../../flash/Services/Drops";
import { Inventory, type InventoryShape } from "../../flash/Services/Inventory";
import {
  GameEvents,
  type GameEventsShape,
} from "../../flash/Services/GameEvents";
import { Packet, type PacketShape } from "../../flash/Services/Packet";
import { Player, type PlayerShape } from "../../flash/Services/Player";
import {
  TempInventory,
  type TempInventoryShape,
} from "../../flash/Services/TempInventory";
import { Wait, type WaitShape } from "../../flash/Services/Wait";
import { World, type WorldShape } from "../../flash/Services/World";
import { Jobs, type JobsShape } from "../../jobs/Services/Jobs";
import { ArmyLive } from "./Army";

const incompleteProgress: ArmyProgressResult = {
  complete: false,
  completedPlayers: ["Main"],
  pendingPlayers: ["Alt"],
};

const completeProgress: ArmyProgressResult = {
  complete: true,
  completedPlayers: ["Main", "Alt"],
  pendingPlayers: [],
};

const session: ArmySession = {
  configName: "config",
  leader: "Main",
  playerName: "Main",
  playerNumber: 1,
  players: ["Main", "Alt"],
  raw: {},
  role: "leader",
  roomNumber: "1",
  sessionId: "session",
};

interface KillCall {
  readonly target: MonsterIdentifierToken;
  readonly options?: CombatKillOptions;
}

const nextValue = <A>(values: readonly A[], index: number, fallback: A): A =>
  values[Math.min(index, values.length - 1)] ?? fallback;

const withArmyItemHarness = async <A>(
  body: (
    army: import("../Services/Army").ArmyShape,
    state: {
      readonly acceptedDrops: ItemIdentifierToken[];
      readonly inventoryChecks: Array<{
        readonly item: ItemIdentifierToken;
        readonly quantity?: number;
      }>;
      readonly killCalls: KillCall[];
      readonly progressPayloads: ArmyProgressPayload[];
      readonly tempChecks: Array<{
        readonly item: ItemIdentifierToken;
        readonly quantity?: number;
      }>;
    },
  ) => Effect.Effect<A, unknown>,
  options?: {
    readonly dropContains?: readonly boolean[];
    readonly inventoryContains?: readonly boolean[];
    readonly progressResults?: readonly ArmyProgressResult[];
    readonly tempContains?: readonly boolean[];
  },
): Promise<A> => {
  const acceptedDrops: ItemIdentifierToken[] = [];
  const inventoryChecks: Array<{
    readonly item: ItemIdentifierToken;
    readonly quantity?: number;
  }> = [];
  const killCalls: KillCall[] = [];
  const progressPayloads: ArmyProgressPayload[] = [];
  const tempChecks: Array<{
    readonly item: ItemIdentifierToken;
    readonly quantity?: number;
  }> = [];
  let dropContainsIndex = 0;
  let inventoryContainsIndex = 0;
  let progressIndex = 0;
  let tempContainsIndex = 0;
  const hadWindow = "window" in globalThis;
  const previousWindow = globalThis.window;

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      ipc: {
        army: {
          barrier: async () => undefined,
          leave: async () => undefined,
          loadConfig: async () => session,
          onLoopTauntCommand: () => () => {},
          progress: async (payload: ArmyProgressPayload) => {
            progressPayloads.push(payload);
            const result = nextValue(
              options?.progressResults ?? [completeProgress],
              progressIndex,
              completeProgress,
            );
            progressIndex += 1;
            return result;
          },
          publishLoopTauntObservation: async () => undefined,
          start: async () => session,
          startLoopTaunt: async () => undefined,
          status: async () => ({ active: true }),
          stopLoopTaunt: async () => undefined,
        },
      },
    },
  });

  const auth = {
    connectTo: () => Effect.die("not used"),
    getLoginSession: () => Effect.die("not used"),
    getPassword: () => Effect.succeed("password"),
    getServers: () => Effect.succeed([]),
    getUsername: () => Effect.succeed(session.playerName),
    isLoggedIn: () => Effect.succeed(true),
    isTemporarilyKicked: () => Effect.succeed(false),
    login: () => Effect.void,
    logout: () => Effect.void,
  } satisfies AuthShape;

  const combat = {
    attackMonster: () => Effect.succeed(true),
    cancelAutoAttack: () => Effect.void,
    cancelTarget: () => Effect.void,
    canUseSkill: () => Effect.succeed(true),
    exit: () => Effect.succeed(true),
    getConsumableSkillItem: () => Effect.succeed(null),
    target: {
      get: () => Effect.succeed(Option.none()),
      auras: {
        getAll: () => Effect.die("not used"),
        get: () => Effect.succeed(Option.none()),
        has: () => Effect.succeed(false),
      },
    },
    hunt: () => Effect.succeed(""),
    kill: (target, killOptions) =>
      Effect.sync(() => {
        killCalls.push(
          killOptions === undefined
            ? { target }
            : { target, options: killOptions },
        );
      }),
    killForItem: () => Effect.void,
    killForTempItem: () => Effect.void,
    useSkill: () => Effect.void,
  } satisfies CombatShape;

  const drops = {
    acceptDrop: (item) =>
      Effect.sync(() => {
        acceptedDrops.push(item);
      }),
    containsDrop: () =>
      Effect.sync(() => {
        const result = nextValue(
          options?.dropContains ?? [false],
          dropContainsIndex,
          false,
        );
        dropContainsIndex += 1;
        return result;
      }),
    getDrops: () => Effect.succeed([]),
    isUsingCustomDrops: () => Effect.succeed(false),
    rejectDrop: () => Effect.succeed(false),
    toggleUi: () => Effect.void,
  } satisfies DropsShape;

  const inventory = {
    contains: (item, quantity) =>
      Effect.sync(() => {
        inventoryChecks.push(
          quantity === undefined ? { item } : { item, quantity },
        );
        const result = nextValue(
          options?.inventoryContains ?? [false],
          inventoryContainsIndex,
          false,
        );
        inventoryContainsIndex += 1;
        return result;
      }),
    equip: () => Effect.succeed(true),
    getAvailableSlots: () => Effect.succeed(1),
    getItem: () => Effect.succeed(null),
    getItems: () => Effect.succeed([]),
    getSlots: () => Effect.succeed(1),
    getUsedSlots: () => Effect.succeed(0),
  } satisfies InventoryShape;

  const tempInventory = {
    contains: (item, quantity) =>
      Effect.sync(() => {
        tempChecks.push(
          quantity === undefined ? { item } : { item, quantity },
        );
        const result = nextValue(
          options?.tempContains ?? [false],
          tempContainsIndex,
          false,
        );
        tempContainsIndex += 1;
        return result;
      }),
    getItem: () => Effect.succeed(null),
    getItems: () => Effect.succeed([]),
  } satisfies TempInventoryShape;

  const jobs = {
    getRunningKeys: () => Effect.succeed([]),
    isRunning: () => Effect.succeed(false),
    start: () => Effect.succeed(true),
    startPeriodic: () => Effect.succeed(true),
    startPeriodicJob: () => Effect.succeed(true),
    stop: () => Effect.succeed(true),
    stopAll: () => Effect.void,
  } satisfies JobsShape;

  const wait = {
    until: <E>(condition: Effect.Effect<boolean, E>) => condition,
    untilSome: <A, E>(condition: Effect.Effect<Option.Option<A>, E>) =>
      condition,
    isGameActionAvailable: () => Effect.succeed(true),
    forGameAction: () => Effect.succeed(true),
  } satisfies WaitShape;

  const serviceLayer = Layer.mergeAll(
    Layer.succeed(Auth)(auth),
    Layer.succeed(Combat)(combat),
    Layer.succeed(Drops)(drops),
    Layer.succeed(Inventory)(inventory),
    Layer.succeed(GameEvents)({
      emit: () => Effect.void,
      on: () => Effect.succeed(() => {}),
      started: true,
    } as GameEventsShape),
    Layer.succeed(Packet)({
      sendServer: () => Effect.void,
    } as unknown as PacketShape),
    Layer.succeed(Player)({
      isReady: () => Effect.succeed(true),
      joinMap: () => Effect.void,
    } as unknown as PlayerShape),
    Layer.succeed(TempInventory)(tempInventory),
    Layer.succeed(Wait)(wait),
    Layer.succeed(World)({
      players: {
        getByName: () => Effect.succeed(Option.none()),
      },
    } as unknown as WorldShape),
    Layer.succeed(Jobs)(jobs),
  );
  const runtimeLayer = ArmyLive.pipe(Layer.provide(serviceLayer));

  try {
    return await Effect.runPromise(
      Effect.gen(function* () {
        const army = yield* Army;
        yield* army.start("config");
        return yield* body(army, {
          acceptedDrops,
          inventoryChecks,
          killCalls,
          progressPayloads,
          tempChecks,
        });
      }).pipe(Effect.provide(runtimeLayer)),
    );
  } finally {
    if (hadWindow) {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: previousWindow,
      });
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  }
};

test("army killForTempItem keeps killing when local temp item is present but army is incomplete", async () => {
  const result = await withArmyItemHarness(
    (army, state) =>
      Effect.gen(function* () {
        const options = {
          killPriority: ["Priority"],
          skillDelay: 0,
          skillSet: [1, 2],
          skillWait: true,
        } satisfies CombatKillOptions;

        yield* army.killForTempItem("Boss", "Temp Drop", 2, options);
        return state;
      }),
    {
      progressResults: [incompleteProgress, completeProgress],
      tempContains: [true, true],
    },
  );

  expect(result.killCalls).toEqual([
    {
      target: "Boss",
      options: {
        killPriority: ["Priority"],
        skillDelay: 0,
        skillSet: [1, 2],
        skillWait: true,
      },
    },
  ]);
  expect(result.progressPayloads.map((payload) => payload.step)).toEqual([
    0, 0,
  ]);
  expect(result.progressPayloads.map((payload) => payload.complete)).toEqual([
    true,
    true,
  ]);
  expect(result.tempChecks).toEqual([
    { item: "Temp Drop", quantity: 2 },
    { item: "Temp Drop", quantity: 2 },
  ]);
});

test("army killForTempItem exits without killing when the whole army is complete", async () => {
  const result = await withArmyItemHarness(
    (army, state) =>
      Effect.gen(function* () {
        yield* army.killForTempItem("Boss", "Temp Drop");
        return state;
      }),
    {
      progressResults: [completeProgress],
      tempContains: [true],
    },
  );

  expect(result.killCalls).toEqual([]);
  expect(result.progressPayloads).toHaveLength(1);
  expect(result.progressPayloads[0]?.complete).toBe(true);
});

test("army killForItem accepts pending drops before reporting completion", async () => {
  const result = await withArmyItemHarness(
    (army, state) =>
      Effect.gen(function* () {
        yield* army.killForItem("Boss", "123", 3);
        return state;
      }),
    {
      dropContains: [true],
      inventoryContains: [true],
      progressResults: [completeProgress],
    },
  );

  expect(result.acceptedDrops).toEqual([123]);
  expect(result.inventoryChecks).toEqual([{ item: 123, quantity: 3 }]);
  expect(result.progressPayloads[0]?.complete).toBe(true);
  expect(result.killCalls).toEqual([]);
});

test("army killForItem keeps the same step while rerunning the kill strategy", async () => {
  const options = {
    killPriority: "Priority, Boss",
    skillDelay: 25,
  } satisfies CombatKillOptions;
  const result = await withArmyItemHarness(
    (army, state) =>
      Effect.gen(function* () {
        yield* army.killForItem("Boss", "Drop", undefined, options);
        return state;
      }),
    {
      inventoryContains: [false, true],
      progressResults: [incompleteProgress, completeProgress],
    },
  );

  expect(result.killCalls).toEqual([{ target: "Boss", options }]);
  expect(result.progressPayloads.map((payload) => payload.step)).toEqual([
    0, 0,
  ]);
  expect(result.progressPayloads.map((payload) => payload.label)).toEqual([
    "kill-item:Drop",
    "kill-item:Drop",
  ]);
});
