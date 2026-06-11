import { Collection } from "@lucent/collection";
import { Avatar, EntityState, Monster, type Aura } from "@lucent/game";
import { Effect, Layer, Option } from "effect";
import { expect, test, vi } from "vitest";
import type { ArmyBarrierPayload } from "../../../../../shared/army";
import type {
  ArmyLoopTauntCommandPayload,
  ArmyLoopTauntObservationPayload,
  ArmyLoopTauntStartPayload,
  ArmyLoopTauntStopPayload,
} from "../../../../../shared/army";
import {
  DEFAULT_LOOP_TAUNT_CAST_SETTLE_MS,
  DEFAULT_LOOP_TAUNT_RESPAWN_RECOVERY_MS,
} from "../LoopTaunt";
import type { ArmySession } from "../Services/Army";
import { Army } from "../Services/Army";
import { Auth, type AuthShape } from "../../flash/Services/Auth";
import { Combat, type CombatShape } from "../../flash/Services/Combat";
import { Drops, type DropsShape } from "../../flash/Services/Drops";
import { Inventory, type InventoryShape } from "../../flash/Services/Inventory";
import {
  GameEvents,
  type GameEvent,
  type GameEventHandler,
  type GameEventMap,
  type GameEventsShape,
} from "../../flash/Services/GameEvents";
import { Player, type PlayerShape } from "../../flash/Services/Player";
import { Packet, type PacketShape } from "../../flash/Services/Packet";
import {
  TempInventory,
  type TempInventoryShape,
} from "../../flash/Services/TempInventory";
import { Wait, type WaitShape } from "../../flash/Services/Wait";
import { World, type WorldShape } from "../../flash/Services/World";
import { matchesAura } from "../../flash/auraMatching";
import { JobGate, type JobGateShape } from "../../jobs/Services/JobGate";
import { JobsLive } from "../../jobs/Layers/Jobs";
import { ArmyLive } from "./Army";

type HandlerStore = {
  [K in GameEvent]: Set<GameEventHandler<K>>;
};

const createStore = (): HandlerStore => ({
  afk: new Set(),
  animationMessage: new Set(),
  auraAdded: new Set(),
  auraRemoved: new Set(),
  antiCounterEnd: new Set(),
  antiCounterStart: new Set(),
  extensionResponse: new Set(),
  joinMap: new Set(),
  loopTauntClientCastAttempt: new Set(),
  loopTauntServerCastConfirmed: new Set(),
  monsterDeath: new Set(),
  packetFromClient: new Set(),
  packetFromServer: new Set(),
  playerDeath: new Set(),
  playerLocation: new Set(),
  questComplete: new Set(),
  zone: new Set(),
});

const wait = {
  until: (condition) => condition,
  untilSome: (condition) => condition,
  isGameActionAvailable: () => Effect.succeed(true),
  forGameAction: () => Effect.succeed(true),
} as WaitShape;

const makeSession = (
  playerNumber: number,
  players: readonly string[] = ["Main", "Alt"],
): ArmySession => {
  const playerName = players[playerNumber - 1];
  if (playerName === undefined) {
    throw new Error(`Missing test army player ${playerNumber}`);
  }

  return {
    configName: "config",
    leader: players[0] ?? playerName,
    playerName,
    playerNumber,
    players,
    raw: {},
    role: playerNumber === 1 ? "leader" : "member",
    roomNumber: "1",
    sessionId: "session",
  };
};

const monster = new Monster({
  iLvl: 1,
  intHP: 100,
  intHPMax: 100,
  intMP: 100,
  intMPMax: 100,
  intState: EntityState.Idle,
  monId: 1,
  monMapId: 7,
  sRace: "None",
  strFrame: "Boss",
  strMonName: "Ultra Boss",
});

const otherMonster = new Monster({
  iLvl: 1,
  intHP: 100,
  intHPMax: 100,
  intMP: 100,
  intMPMax: 100,
  intState: EntityState.Idle,
  monId: 2,
  monMapId: 8,
  sRace: "None",
  strFrame: "Boss",
  strMonName: "Other Boss",
});

const auraKey = (auraName: string): string => auraName.trim().toLowerCase();

const makeAvatar = (name: string, index: number): Avatar =>
  new Avatar({
    afk: false,
    entID: index + 1,
    entType: "player",
    intHP: 100,
    intHPMax: 100,
    intLevel: 100,
    intMP: 100,
    intMPMax: 100,
    intState: EntityState.Idle,
    strFrame: "Boss",
    strPad: "Spawn",
    strUsername: name,
    tx: 0,
    ty: 0,
    uoName: name.toLowerCase(),
  });

const auraCollection = (
  auras: ReadonlyMap<string, Aura> | undefined,
): Collection<string, Aura> => new Collection(Array.from(auras ?? []));

const makeWorld = (
  auras: Map<string, Aura>,
  playerNames: readonly string[],
  playerAuras: ReadonlyMap<number, ReadonlyMap<string, Aura>> = new Map(),
): WorldShape => ({
  map: {
    getCells: () => Effect.succeed(["Enter", "Boss"]),
    getCellPads: () => Effect.succeed(["Spawn"]),
    getId: () => Effect.succeed(1),
    getMapItem: () => Effect.void,
    getName: () => Effect.succeed("test"),
    getRoomNumber: () => Effect.succeed(1),
    isLoaded: () => Effect.succeed(true),
    loadSwf: () => Effect.void,
    reload: () => Effect.void,
    reset: () => Effect.void,
    setId: () => Effect.void,
    setName: () => Effect.void,
    setRoomNumber: () => Effect.void,
    setSpawnPoint: () => Effect.void,
  },
  players: {
    add: () => Effect.void,
    addAura: () => Effect.void,
    clearAuras: () => Effect.void,
    get: (selector) => {
      const players = playerNames.map(makeAvatar);
      const player =
        typeof selector === "number"
          ? players.find((player) => player.data.entID === selector)
          : typeof selector === "string"
            ? players.find(
                (player) =>
                  player.username.toLowerCase() === selector.toLowerCase(),
              )
            : players.find((player) => {
                if (
                  selector.entId !== undefined &&
                  player.data.entID !== selector.entId
                ) {
                  return false;
                }

                return (
                  selector.username === undefined ||
                  player.username.toLowerCase() ===
                    selector.username.toLowerCase()
                );
              });

      return Effect.succeed(Option.fromNullishOr(player));
    },
    getAll: () =>
      Effect.succeed(
        new Collection(
          playerNames.map((name, index) => [
            name.toLowerCase(),
            makeAvatar(name, index),
          ]),
        ),
      ),
    getAura: (entId, auraName) =>
      Effect.succeed(
        Option.fromNullishOr(playerAuras.get(entId)?.get(auraKey(auraName))),
      ),
    getAuras: (entId) => Effect.succeed(auraCollection(playerAuras.get(entId))),
    getByName: (name) =>
      Effect.succeed(
        Option.fromNullishOr(
          playerNames
            .map(
              (playerName, index) =>
                new Avatar({
                  afk: false,
                  entID: index + 1,
                  entType: "player",
                  intHP: 100,
                  intHPMax: 100,
                  intLevel: 100,
                  intMP: 100,
                  intMPMax: 100,
                  intState: EntityState.Idle,
                  strFrame: "Boss",
                  strPad: "Spawn",
                  strUsername: playerName,
                  tx: 0,
                  ty: 0,
                  uoName: playerName.toLowerCase(),
                }),
            )
            .find(
              (player) => player.username.toLowerCase() === name.toLowerCase(),
            ),
        ),
      ),
    getSelf: () => Effect.succeed(Option.none()),
    register: () => Effect.void,
    remove: () => Effect.void,
    removeAura: () => Effect.void,
    setSelf: () => Effect.void,
    unregister: () => Effect.void,
    updateAura: () => Effect.void,
    withSelf: () => Effect.succeed(Option.none()),
    auras: {
      getAll: (selector) =>
        Effect.gen(function* () {
          const player = yield* makeWorld(
            auras,
            playerNames,
            playerAuras,
          ).players.get(selector);
          return Option.isSome(player)
            ? auraCollection(playerAuras.get(player.value.data.entID))
            : new Collection<string, Aura>();
        }),
      get: (selector, auraName) =>
        Effect.gen(function* () {
          const player = yield* makeWorld(
            auras,
            playerNames,
            playerAuras,
          ).players.get(selector);
          return Option.isSome(player)
            ? Option.fromNullishOr(
                playerAuras
                  .get(player.value.data.entID)
                  ?.get(auraKey(auraName)),
              )
            : Option.none<Aura>();
        }),
      has: (selector, auraName, options) =>
        Effect.gen(function* () {
          const aura = yield* makeWorld(
            auras,
            playerNames,
            playerAuras,
          ).players.auras.get(selector, auraName);
          return matchesAura(
            Option.isSome(aura) ? aura.value : undefined,
            options,
          );
        }),
    },
  },
  monsters: {
    add: () => Effect.void,
    addAura: () => Effect.void,
    clearAuras: () => Effect.void,
    findByName: (name) =>
      Effect.succeed(
        name === "Ultra Boss" ? Option.some(monster) : Option.none(),
      ),
    get: (selector) => {
      const monsters = new Map([
        [7, monster],
        [8, otherMonster],
      ]);
      const match =
        typeof selector === "number"
          ? monsters.get(selector)
          : typeof selector === "string"
            ? selector === "Ultra Boss"
              ? monster
              : undefined
            : selector.monMapId !== undefined
              ? monsters.get(selector.monMapId)
              : selector.name === "Ultra Boss"
                ? monster
                : undefined;

      return Effect.succeed(Option.fromNullishOr(match));
    },
    getAll: () =>
      Effect.succeed(
        new Collection([
          [7, monster],
          [8, otherMonster],
        ]),
      ),
    getAvailable: () => Effect.succeed(new Collection([[7, monster]])),
    isAvailable: () => Effect.succeed(true),
    getAuras: () => Effect.succeed(auraCollection(auras)),
    getAura: (_monMapId, auraName) =>
      Effect.succeed(Option.fromNullishOr(auras.get(auraKey(auraName)))),
    removeAura: () => Effect.void,
    updateAura: () => Effect.void,
    auras: {
      getAll: () => Effect.succeed(auraCollection(auras)),
      get: (_selector, auraName) =>
        Effect.succeed(Option.fromNullishOr(auras.get(auraKey(auraName)))),
      has: (_selector, auraName, options) =>
        Effect.sync(() => {
          const aura = auras.get(auraKey(auraName));
          return matchesAura(aura, options);
        }),
    },
  },
  entities: {
    getAll: () => Effect.succeed(new Collection()),
    getMe: () => Effect.succeed(Option.none()),
    get: () => Effect.succeed(Option.none()),
  },
});

const inventory = {
  contains: () => Effect.succeed(false),
  equip: () => Effect.succeed(true),
  getAvailableSlots: () => Effect.succeed(1),
  getItem: () => Effect.succeed(null),
  getItems: () => Effect.succeed([]),
  getSlots: () => Effect.succeed(1),
  getUsedSlots: () => Effect.succeed(0),
} satisfies InventoryShape;

const drops = {
  acceptDrop: () => Effect.void,
  containsDrop: () => Effect.succeed(false),
  getDrops: () => Effect.succeed([]),
  isUsingCustomDrops: () => Effect.succeed(false),
  rejectDrop: () => Effect.succeed(false),
  toggleUi: () => Effect.void,
} satisfies DropsShape;

const tempInventory = {
  contains: () => Effect.succeed(false),
  getItem: () => Effect.succeed(null),
  getItems: () => Effect.succeed([]),
} satisfies TempInventoryShape;

const jobGate = {
  isOpen: () => Effect.succeed(true),
} satisfies JobGateShape;

const withArmy = async <A>(
  session: ArmySession,
  body: (
    army: import("../Services/Army").ArmyShape,
    emit: <E extends GameEvent>(
      event: E,
      payload: GameEventMap[E],
    ) => Effect.Effect<void, unknown>,
    calls: string[],
    barriers: ArmyBarrierPayload[],
  ) => Effect.Effect<A, unknown>,
  options?: {
    readonly hasAura?: boolean;
    readonly isAlive?: () => Effect.Effect<boolean>;
    readonly isReady?: () => Effect.Effect<boolean>;
    readonly playerAuras?: ReadonlyMap<number, ReadonlyMap<string, Aura>>;
  },
): Promise<A> => {
  const store = createStore();
  const calls: string[] = [];
  const barriers: ArmyBarrierPayload[] = [];
  const loopTauntCommandListeners = new Set<
    (payload: ArmyLoopTauntCommandPayload) => void
  >();
  let loopTaunt:
    | (ArmyLoopTauntStartPayload & { readonly nextIndex: number })
    | undefined;
  const auras = new Map<string, Aura>();
  if (options?.hasAura === true) {
    auras.set(auraKey("Focus"), {
      duration: 6,
      icon: "iwd1,ied1",
      name: "Focus",
    });
  }
  const hadWindow = "window" in globalThis;
  const previousWindow = globalThis.window;

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      ipc: {
        army: {
          barrier: async (payload: ArmyBarrierPayload) => {
            barriers.push(payload);
          },
          leave: async () => undefined,
          loadConfig: async () => session,
          onLoopTauntCommand: (
            listener: (payload: ArmyLoopTauntCommandPayload) => void,
          ) => {
            loopTauntCommandListeners.add(listener);
            return () => {
              loopTauntCommandListeners.delete(listener);
            };
          },
          publishLoopTauntObservation: async (
            observation: ArmyLoopTauntObservationPayload,
          ) => {
            if (
              loopTaunt === undefined ||
              loopTaunt.id !== observation.id ||
              loopTaunt.targetMonMapId !== observation.targetMonMapId ||
              (observation.type !== "aura-missing" &&
                observation.type !== "aura-removed")
            ) {
              return;
            }

            const selected =
              loopTaunt.participants[
                loopTaunt.nextIndex % loopTaunt.participants.length
              ];
            if (selected === undefined) {
              return;
            }

            loopTaunt = {
              ...loopTaunt,
              nextIndex:
                (loopTaunt.nextIndex + 1) % loopTaunt.participants.length,
            };

            const command: ArmyLoopTauntCommandPayload = {
              attempt: 1,
              epoch: loopTaunt.nextIndex,
              id: loopTaunt.id,
              reason: observation.type,
              selected,
              sessionId: loopTaunt.sessionId,
              skill: loopTaunt.skill,
              targetMonMapId: loopTaunt.targetMonMapId,
            };
            const sendCommand = () => {
              for (const listener of loopTauntCommandListeners) {
                listener(command);
              }
            };

            setTimeout(
              sendCommand,
              observation.type === "aura-removed" ? loopTaunt.delayMs : 0,
            );
          },
          start: async () => session,
          startLoopTaunt: async (payload: ArmyLoopTauntStartPayload) => {
            loopTaunt = { ...payload, nextIndex: 0 };
          },
          status: async () => ({ active: true }),
          stopLoopTaunt: async (_payload: ArmyLoopTauntStopPayload) => {
            loopTaunt = undefined;
          },
        },
      },
    },
  });

  const auth = {
    connectTo: () =>
      Effect.succeed({
        message: "connected",
        retryable: false,
        status: "connected",
      } as const),
    getLoginSession: () =>
      Effect.succeed({
        bSuccess: 1,
        iUpg: 0,
        servers: [],
        sToken: "password",
        unm: session.playerName,
      }),
    getPassword: () => Effect.succeed("password"),
    getServers: () => Effect.succeed([]),
    getUsername: () => Effect.succeed(session.playerName),
    isLoggedIn: () => Effect.succeed(true),
    isTemporarilyKicked: () => Effect.succeed(false),
    login: () => Effect.void,
    logout: () => Effect.void,
  } satisfies AuthShape;

  let currentTargetMonMapId: number | undefined;

  const combat = {
    attackMonster: (target) =>
      Effect.sync(() => {
        if (typeof target === "number") {
          currentTargetMonMapId = target;
        }
        calls.push(`attack:${String(target)}`);
        return true;
      }),
    cancelAutoAttack: () => Effect.void,
    cancelTarget: () => Effect.void,
    canUseSkill: () => Effect.succeed(true),
    exit: () => Effect.succeed(true),
    getConsumableSkillItem: () => Effect.succeed(null),
    target: {
      get: () =>
        Effect.succeed(
          currentTargetMonMapId === 7
            ? Option.some({
                entity: monster,
                key: "monster:7" as const,
                monMapId: 7,
                name: monster.name,
                type: "monster" as const,
              })
            : currentTargetMonMapId === 8
              ? Option.some({
                  entity: otherMonster,
                  key: "monster:8" as const,
                  monMapId: 8,
                  name: otherMonster.name,
                  type: "monster" as const,
                })
              : Option.none(),
        ),
      auras: {
        getAll: () => Effect.succeed(new Collection()),
        get: () => Effect.succeed(Option.none()),
        has: () => Effect.succeed(false),
      },
    },
    hunt: () => Effect.succeed(""),
    kill: () => Effect.void,
    killForItem: () => Effect.void,
    killForTempItem: () => Effect.void,
    useSkill: (skill) =>
      Effect.sync(() => {
        calls.push(`skill:${String(skill)}`);
      }),
  } satisfies CombatShape;

  const packetDomain = {
    started: true,
    emit: () => Effect.void,
    on: (event, handler) =>
      Effect.sync(() => {
        const handlers = store[event] as Set<typeof handler>;
        handlers.add(handler);
        return () => {
          handlers.delete(handler);
        };
      }),
  } satisfies GameEventsShape;

  const packet = {
    client: () => Effect.succeed(() => {}),
    clientScoped: () => Effect.void,
    extension: () => Effect.succeed(() => {}),
    extensionScoped: () => Effect.void,
    extensionType: () => Effect.succeed(() => {}),
    extensionTypeScoped: () => Effect.void,
    json: () => Effect.succeed(() => {}),
    jsonScoped: () => Effect.void,
    onExtensionResponse: () => Effect.succeed(() => {}),
    packetFromClient: () => Effect.succeed(() => {}),
    packetFromServer: () => Effect.succeed(() => {}),
    scoped: () => Effect.void,
    sendClient: () => Effect.void,
    sendServer: () => Effect.void,
    server: () => Effect.succeed(() => {}),
    serverScoped: () => Effect.void,
    str: () => Effect.succeed(() => {}),
    strScoped: () => Effect.void,
  } satisfies PacketShape;

  const player = {
    getCell: () => Effect.succeed("Boss"),
    getClassName: () => Effect.succeed("CHAOS AVENGER"),
    getFactions: () => Effect.succeed(new Collection()),
    getGender: () => Effect.succeed("M"),
    getGold: () => Effect.succeed(0),
    getHp: () => Effect.succeed(1),
    getLevel: () => Effect.succeed(1),
    getMaxHp: () => Effect.succeed(1),
    getMaxMp: () => Effect.succeed(1),
    getMp: () => Effect.succeed(1),
    getPad: () => Effect.succeed("Spawn"),
    getPosition: () => Effect.succeed([0, 0] as [number, number]),
    getState: () => Effect.succeed(EntityState.Idle),
    goToPlayer: () => Effect.void,
    hasActiveBoost: () => Effect.succeed(false),
    isAfk: () => Effect.succeed(false),
    isAlive: options?.isAlive ?? (() => Effect.succeed(true)),
    isMember: () => Effect.succeed(false),
    isReady: options?.isReady ?? (() => Effect.succeed(true)),
    joinMap: () => Effect.void,
    jumpToCell: () => Effect.void,
    rest: () => Effect.void,
    useBoost: () => Effect.succeed(true),
    walkTo: () => Effect.succeed(true),
  } satisfies PlayerShape;

  const emit = <E extends GameEvent>(event: E, payload: GameEventMap[E]) =>
    Effect.gen(function* () {
      if (event === "auraAdded" || event === "auraRemoved") {
        const auraPayload = payload as GameEventMap[
          | "auraAdded"
          | "auraRemoved"];
        if (auraPayload.targetType === "monster") {
          if (event === "auraAdded") {
            auras.set(auraKey(auraPayload.auraName), {
              duration: 1,
              name: auraPayload.auraName,
              ...auraPayload.aura,
            });
          } else {
            auras.delete(auraKey(auraPayload.auraName));
          }
        }
      }

      yield* Effect.forEach(
        Array.from(store[event]) as readonly GameEventHandler<E>[],
        (handler) => handler(payload),
        { discard: true },
      );
    });

  const runtimeLayer = ArmyLive.pipe(
    Layer.provide(
      Layer.mergeAll(
        JobsLive.pipe(Layer.provide(Layer.succeed(JobGate)(jobGate))),
        Layer.succeed(Auth)(auth),
        Layer.succeed(Combat)(combat),
        Layer.succeed(Drops)(drops),
        Layer.succeed(Inventory)(inventory),
        Layer.succeed(GameEvents)(packetDomain),
        Layer.succeed(Packet)(packet),
        Layer.succeed(Player)(player),
        Layer.succeed(TempInventory)(tempInventory),
        Layer.succeed(Wait)(wait),
        Layer.succeed(World)(
          makeWorld(auras, session.players, options?.playerAuras),
        ),
      ),
    ),
  );

  try {
    return await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const army = yield* Army;
          return yield* body(army, emit, calls, barriers);
        }),
      ).pipe(Effect.provide(runtimeLayer)),
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

test("Loop Taunt autonomously taunts first in aura mode when aura is absent", async () => {
  const calls = await withArmy(makeSession(1), (army, _emit, calls) =>
    Effect.gen(function* () {
      yield* army.start("config");
      const handle = yield* army.startLoopTaunt({
        aura: "Focus",
        skill: 5,
        target: "Ultra Boss",
      });

      yield* Effect.sleep("100 millis");
      yield* handle.stop();
      return calls;
    }),
  );

  expect(calls).toEqual(["attack:7", "attack:7", "skill:5"]);
});

test("Loop Taunt skips local cast while player is petrified", async () => {
  const calls = await withArmy(
    makeSession(1),
    (army, _emit, calls) =>
      Effect.gen(function* () {
        yield* army.start("config");
        const handle = yield* army.startLoopTaunt({
          aura: "Focus",
          skill: 5,
          target: "Ultra Boss",
        });

        yield* Effect.sleep("100 millis");
        yield* handle.stop();
        return calls;
      }),
    {
      playerAuras: new Map([
        [
          1,
          new Map([
            [
              auraKey("Petrified"),
              {
                cat: "stone",
                duration: 4,
                name: "Petrified",
              },
            ],
          ]),
        ],
      ]),
    },
  );

  expect(calls).toEqual(["attack:7"]);
});

test("Loop Taunt selects replacement participant in aura mode", async () => {
  const calls = await withArmy(makeSession(2), (army, _emit, calls) =>
    Effect.gen(function* () {
      yield* army.start("config");
      const handle = yield* army.startLoopTaunt({
        aura: "Focus",
        players: [1, 2],
        shouldTaunt: ({ candidate }) => candidate.number === 2,
        skill: 5,
        target: "Ultra Boss",
      });

      yield* Effect.sleep("100 millis");
      yield* handle.stop();
      return calls;
    }),
  );

  expect(calls).toEqual(["attack:7", "attack:7", "skill:5"]);
});

test("Loop Taunt does not cast locally when replacement is another participant", async () => {
  const calls = await withArmy(makeSession(1), (army, _emit, calls) =>
    Effect.gen(function* () {
      yield* army.start("config");
      const handle = yield* army.startLoopTaunt({
        aura: "Focus",
        players: [1, 2],
        shouldTaunt: ({ candidate }) => candidate.number === 2,
        skill: 5,
        target: "Ultra Boss",
      });

      yield* Effect.sleep("100 millis");
      yield* handle.stop();
      return calls;
    }),
  );

  expect(calls).toEqual(["attack:7"]);
});

test("Loop Taunt advances message turns and only casts on local player turn", async () => {
  const calls = await withArmy(makeSession(2), (army, emit, calls) =>
    Effect.gen(function* () {
      yield* army.start("config");
      const handle = yield* army.startLoopTaunt({
        message: "defense shattering",
        players: [1, 2],
        skill: 5,
        target: "id:7",
      });

      yield* Effect.sleep("25 millis");
      yield* emit("animationMessage", {
        message: "defense shattering",
        monMapId: 7,
        packet: { cmd: "ct", data: {}, raw: "", type: "server" },
      });
      yield* Effect.sleep("25 millis");
      yield* emit("animationMessage", {
        message: "defense shattering",
        monMapId: 7,
        packet: { cmd: "ct", data: {}, raw: "", type: "server" },
      });
      yield* Effect.sleep("25 millis");

      yield* handle.stop();
      return calls;
    }),
  );

  expect(calls).toEqual(["attack:7", "attack:7", "skill:5"]);
});

test("Loop Taunt selects replacement participant in message mode", async () => {
  const calls = await withArmy(makeSession(2), (army, emit, calls) =>
    Effect.gen(function* () {
      yield* army.start("config");
      const handle = yield* army.startLoopTaunt({
        message: "defense shattering",
        players: [1, 2],
        shouldTaunt: ({ candidate }) => candidate.number === 2,
        skill: 5,
        target: "id:7",
      });

      yield* Effect.sleep("25 millis");
      yield* emit("animationMessage", {
        message: "defense shattering",
        monMapId: 7,
        packet: { cmd: "ct", data: {}, raw: "", type: "server" },
      });
      yield* Effect.sleep("25 millis");

      yield* handle.stop();
      return calls;
    }),
  );

  expect(calls).toEqual(["attack:7", "attack:7", "skill:5"]);
});

test("Loop Taunt message mode prefers animation source monster id", async () => {
  const calls = await withArmy(makeSession(2), (army, emit, calls) =>
    Effect.gen(function* () {
      yield* army.start("config");
      const handle = yield* army.startLoopTaunt({
        message: "defense shattering",
        players: [2],
        skill: 5,
        target: "id:7",
      });

      yield* Effect.sleep("25 millis");
      yield* emit("animationMessage", {
        message: "defense shattering",
        monMapId: 8,
        packet: { cmd: "ct", data: {}, raw: "", type: "server" },
        sourceMonMapId: 8,
        targetMonMapId: 7,
      });
      yield* Effect.sleep("25 millis");
      const afterWrongSource = [...calls];

      yield* emit("animationMessage", {
        message: "defense shattering",
        monMapId: 7,
        packet: { cmd: "ct", data: {}, raw: "", type: "server" },
        sourceMonMapId: 7,
        targetMonMapId: 8,
      });
      yield* Effect.sleep("25 millis");

      yield* handle.stop();
      return { afterWrongSource, calls };
    }),
  );

  expect(calls.afterWrongSource).toEqual(["attack:7"]);
  expect(calls.calls).toEqual(["attack:7", "attack:7", "skill:5"]);
});

test("Loop Taunt debounces duplicate message triggers for the same target", async () => {
  const calls = await withArmy(makeSession(2), (army, emit, calls) =>
    Effect.gen(function* () {
      yield* army.start("config");
      const handle = yield* army.startLoopTaunt({
        debounceMs: 1000,
        message: "defense shattering",
        players: [2],
        skill: 5,
        target: "id:7",
      });

      yield* Effect.sleep("25 millis");
      yield* emit("animationMessage", {
        message: "defense shattering",
        monMapId: 7,
        packet: { cmd: "ct", data: {}, raw: "", type: "server" },
        sourceMonMapId: 7,
      });
      yield* Effect.sleep("25 millis");
      yield* emit("animationMessage", {
        message: "defense shattering",
        monMapId: 7,
        packet: { cmd: "ct", data: {}, raw: "", type: "server" },
        sourceMonMapId: 7,
      });
      yield* Effect.sleep("25 millis");

      yield* handle.stop();
      return calls;
    }),
  );

  expect(calls).toEqual(["attack:7", "attack:7", "skill:5"]);
});

test("Loop Taunt debounces message triggers per target", async () => {
  const calls = await withArmy(makeSession(2), (army, emit, calls) =>
    Effect.gen(function* () {
      yield* army.start("config");
      const first = yield* army.startLoopTaunt({
        debounceMs: 1000,
        id: "first",
        message: "defense shattering",
        players: [2],
        skill: 5,
        target: "id:7",
      });
      const second = yield* army.startLoopTaunt({
        debounceMs: 1000,
        id: "second",
        message: "defense shattering",
        players: [2],
        skill: 5,
        target: "id:8",
      });

      yield* Effect.sleep("25 millis");
      yield* emit("animationMessage", {
        message: "defense shattering",
        monMapId: 7,
        packet: { cmd: "ct", data: {}, raw: "", type: "server" },
        sourceMonMapId: 7,
      });
      yield* emit("animationMessage", {
        message: "defense shattering",
        monMapId: 8,
        packet: { cmd: "ct", data: {}, raw: "", type: "server" },
        sourceMonMapId: 8,
      });
      yield* Effect.sleep("25 millis");

      yield* first.stop();
      yield* second.stop();
      return calls;
    }),
  );

  expect(calls.filter((call) => call === "skill:5")).toHaveLength(2);
  expect(calls).toContain("attack:7");
  expect(calls).toContain("attack:8");
});

test("Loop Taunt skips a candidate when shouldTaunt fails", async () => {
  const calls = await withArmy(makeSession(2), (army, _emit, calls) =>
    Effect.gen(function* () {
      yield* army.start("config");
      const handle = yield* army.startLoopTaunt({
        aura: "Focus",
        players: [1, 2],
        shouldTaunt: ({ candidate }) => {
          if (candidate.number === 1) {
            throw new Error("candidate unavailable");
          }

          return true;
        },
        skill: 5,
        target: "Ultra Boss",
      });

      yield* Effect.sleep("100 millis");
      yield* handle.stop();
      return calls;
    }),
  );

  expect(calls).toEqual(["attack:7", "attack:7", "skill:5"]);
});

test("Loop Taunt shouldTaunt can skip a high Vendetta candidate", async () => {
  const calls = await withArmy(
    makeSession(2),
    (army, _emit, calls) =>
      Effect.gen(function* () {
        yield* army.start("config");
        const handle = yield* army.startLoopTaunt({
          aura: "Focus",
          players: [1, 2],
          shouldTaunt: ({ candidate, world }) =>
            Effect.gen(function* () {
              const player = yield* world.players.getByName(candidate.name);
              if (Option.isNone(player)) {
                return false;
              }

              const vendetta = yield* world.players.getAura(
                player.value.data.entID,
                "Vendetta",
              );
              if (Option.isNone(vendetta)) {
                return true;
              }

              return (vendetta.value.stack ?? vendetta.value.value ?? 1) <= 3;
            }),
          skill: 5,
          target: "Ultra Boss",
        });

        yield* Effect.sleep("100 millis");
        yield* handle.stop();
        return calls;
      }),
    {
      playerAuras: new Map([
        [
          1,
          new Map([
            [auraKey("Vendetta"), { duration: 10, name: "Vendetta", stack: 4 }],
          ]),
        ],
      ]),
    },
  );

  expect(calls).toEqual(["attack:7", "attack:7", "skill:5"]);
});

test("Loop Taunt stops without casting when every participant is skipped", async () => {
  const calls = await withArmy(makeSession(1), (army, _emit, calls) =>
    Effect.gen(function* () {
      yield* army.start("config");
      const handle = yield* army.startLoopTaunt({
        aura: "Focus",
        players: [1, 2],
        shouldTaunt: () => false,
        skill: 5,
        target: "Ultra Boss",
      });

      yield* Effect.sleep("100 millis");
      yield* handle.stop();
      return calls;
    }),
  );

  expect(calls).toEqual(["attack:7"]);
});

test("Loop Taunt does not retry locally when selected player is unavailable", async () => {
  vi.useFakeTimers();
  try {
    let aliveChecks = 0;
    const promise = withArmy(
      makeSession(1),
      (army, _emit, calls) =>
        Effect.gen(function* () {
          yield* army.start("config");
          const handle = yield* army.startLoopTaunt({
            aura: "Focus",
            delayMs: 0,
            players: [1],
            skill: 5,
            target: "Ultra Boss",
          });

          yield* Effect.sleep(
            `${DEFAULT_LOOP_TAUNT_CAST_SETTLE_MS + 500} millis`,
          );
          yield* handle.stop();
          return calls;
        }),
      {
        isAlive: () =>
          Effect.sync(() => {
            aliveChecks += 1;
            return aliveChecks > 1;
          }),
      },
    );

    await vi.advanceTimersByTimeAsync(DEFAULT_LOOP_TAUNT_CAST_SETTLE_MS + 500);
    const calls = await promise;

    expect(calls).toEqual(["attack:7"]);
  } finally {
    vi.useRealTimers();
  }
});

test("Loop Taunt leaves missed-turn handoff to the coordinator", async () => {
  vi.useFakeTimers();
  try {
    const recoveryMs =
      DEFAULT_LOOP_TAUNT_CAST_SETTLE_MS +
      DEFAULT_LOOP_TAUNT_RESPAWN_RECOVERY_MS +
      DEFAULT_LOOP_TAUNT_CAST_SETTLE_MS +
      50;
    const promise = withArmy(makeSession(2), (army, _emit, calls) =>
      Effect.gen(function* () {
        yield* army.start("config");
        const handle = yield* army.startLoopTaunt({
          aura: "Focus",
          delayMs: 0,
          players: [1, 2],
          skill: 5,
          target: "Ultra Boss",
        });

        yield* Effect.sleep(`${recoveryMs} millis`);
        yield* handle.stop();
        return calls;
      }),
    );

    await vi.advanceTimersByTimeAsync(recoveryMs);
    const calls = await promise;

    expect(calls).toEqual(["attack:7"]);
  } finally {
    vi.useRealTimers();
  }
});

test("Loop Taunt cancels recovery when Focus is restored", async () => {
  vi.useFakeTimers();
  try {
    const recoveryMs =
      DEFAULT_LOOP_TAUNT_CAST_SETTLE_MS +
      DEFAULT_LOOP_TAUNT_RESPAWN_RECOVERY_MS +
      DEFAULT_LOOP_TAUNT_CAST_SETTLE_MS +
      50;
    const promise = withArmy(makeSession(2), (army, emit, calls) =>
      Effect.gen(function* () {
        yield* army.start("config");
        const handle = yield* army.startLoopTaunt({
          aura: "Focus",
          delayMs: 0,
          players: [1, 2],
          skill: 5,
          target: "Ultra Boss",
        });

        yield* Effect.sleep(
          `${DEFAULT_LOOP_TAUNT_CAST_SETTLE_MS + 100} millis`,
        );
        yield* emit("auraAdded", {
          aura: { duration: 6, icon: "iwd1,ied1", name: "Focus" },
          auraName: "Focus",
          packet: { cmd: "ct", data: {}, raw: "", type: "server" },
          targetId: 7,
          targetType: "monster",
        });
        yield* Effect.sleep(`${recoveryMs} millis`);
        yield* handle.stop();
        return calls;
      }),
    );

    await vi.advanceTimersByTimeAsync(
      recoveryMs + DEFAULT_LOOP_TAUNT_CAST_SETTLE_MS + 100,
    );
    const calls = await promise;

    expect(calls).toEqual(["attack:7"]);
  } finally {
    vi.useRealTimers();
  }
});

test("Loop Taunt renderer does not run local recovery timers", async () => {
  vi.useFakeTimers();
  try {
    const delayMs = 1_000;
    const beforeRecoveryMs = delayMs + DEFAULT_LOOP_TAUNT_CAST_SETTLE_MS - 1;
    const recoveryMs =
      DEFAULT_LOOP_TAUNT_RESPAWN_RECOVERY_MS +
      DEFAULT_LOOP_TAUNT_CAST_SETTLE_MS +
      50;
    const promise = withArmy(makeSession(2), (army, _emit, calls) =>
      Effect.gen(function* () {
        yield* army.start("config");
        const handle = yield* army.startLoopTaunt({
          aura: "Focus",
          delayMs,
          players: [1, 2],
          skill: 5,
          target: "Ultra Boss",
        });

        yield* Effect.sleep(`${beforeRecoveryMs} millis`);
        const beforeRecovery = [...calls];
        yield* Effect.sleep(`${recoveryMs} millis`);
        yield* handle.stop();
        return { beforeRecovery, calls };
      }),
    );

    await vi.advanceTimersByTimeAsync(beforeRecoveryMs + recoveryMs);
    const result = await promise;

    expect(result.beforeRecovery).toEqual(["attack:7"]);
    expect(result.calls).toEqual(["attack:7"]);
  } finally {
    vi.useRealTimers();
  }
});

test("Loop Taunt finalizer interrupts pending recovery", async () => {
  vi.useFakeTimers();
  try {
    const recoveryStartedMs = DEFAULT_LOOP_TAUNT_CAST_SETTLE_MS + 100;
    const afterStopMs =
      DEFAULT_LOOP_TAUNT_RESPAWN_RECOVERY_MS +
      DEFAULT_LOOP_TAUNT_CAST_SETTLE_MS +
      100;
    const promise = withArmy(makeSession(2), (army, _emit, calls) =>
      Effect.gen(function* () {
        yield* army.start("config");
        const handle = yield* army.startLoopTaunt({
          aura: "Focus",
          delayMs: 0,
          players: [1, 2],
          skill: 5,
          target: "Ultra Boss",
        });

        yield* Effect.sleep(`${recoveryStartedMs} millis`);
        yield* handle.stop();
        yield* Effect.sleep(`${afterStopMs} millis`);
        return calls;
      }),
    );

    await vi.advanceTimersByTimeAsync(recoveryStartedMs + afterStopMs);
    const calls = await promise;

    expect(calls).toEqual(["attack:7"]);
  } finally {
    vi.useRealTimers();
  }
});

test("Loop Taunt waits for aura removal and delay before next participant casts", async () => {
  const result = await withArmy(
    makeSession(2),
    (army, emit, calls) =>
      Effect.gen(function* () {
        yield* army.start("config");
        const handle = yield* army.startLoopTaunt({
          aura: "Focus",
          delayMs: 30,
          players: [2],
          skill: 5,
          target: "Ultra Boss",
        });

        yield* Effect.sleep("100 millis");
        yield* emit("auraRemoved", {
          auraName: "Focus",
          packet: { cmd: "ct", data: {}, raw: "", type: "server" },
          targetId: 7,
          targetType: "monster",
        });
        yield* Effect.sleep("10 millis");
        const beforeDelay = [...calls];
        yield* Effect.sleep("50 millis");

        yield* handle.stop();
        return {
          beforeDelay,
          calls,
        };
      }),
    { hasAura: true },
  );

  expect(result.beforeDelay).toEqual(["attack:7"]);
  expect(result.calls).toEqual(["attack:7", "attack:7", "skill:5"]);
});

test("Loop Taunt synchronizes only configured participants", async () => {
  const result = await withArmy(
    makeSession(3, ["Main", "Alt", "Third"]),
    (army, _emit, calls, barriers) =>
      Effect.gen(function* () {
        yield* army.start("config");
        const handle = yield* army.startLoopTaunt({
          aura: "Focus",
          players: [1, 2],
          skill: 5,
          target: "Ultra Boss",
        });

        yield* Effect.sleep("100 millis");
        yield* handle.stop();
        return {
          barriers,
          calls,
        };
      }),
  );

  expect(result.calls).toEqual([]);
  expect(
    result.barriers.map((barrier) => ({
      label: barrier.label,
      players: barrier.players,
    })),
  ).toEqual([
    {
      label: "loop-taunt-target:loop-taunt:Ultra Boss:aura:Focus",
      players: ["Main", "Alt"],
    },
    {
      label: "loop-taunt-armed:loop-taunt:Ultra Boss:aura:Focus",
      players: ["Main", "Alt"],
    },
  ]);
});
