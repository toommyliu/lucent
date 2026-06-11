import { Collection } from "@lucent/collection";
import { Data, Effect, Layer, Option } from "effect";
import { expect, test } from "vitest";
import { Army } from "../../army/Services/Army";
import { AutoRelogin } from "../../features/Services/AutoRelogin";
import { AutoZone } from "../../features/Services/AutoZone";
import { Auth, type AuthShape } from "../../flash/Services/Auth";
import { Bank } from "../../flash/Services/Bank";
import { Bridge, type BridgeShape } from "../../flash/Services/Bridge";
import { Combat, type CombatShape } from "../../flash/Services/Combat";
import { Drops } from "../../flash/Services/Drops";
import { Environment } from "../../environment/Services/Environment";
import {
  GameEvents,
  type GameEvent,
  type GameEventHandler,
  type GameEventsShape,
} from "../../flash/Services/GameEvents";
import { House } from "../../flash/Services/House";
import { Inventory } from "../../flash/Services/Inventory";
import { Outfits } from "../../flash/Services/Outfits";
import { Packet, type PacketShape } from "../../flash/Services/Packet";
import { Player, type PlayerShape } from "../../flash/Services/Player";
import { Quests } from "../../flash/Services/Quests";
import { Settings } from "../../flash/Services/Settings";
import { Shops } from "../../flash/Services/Shops";
import { TempInventory } from "../../flash/Services/TempInventory";
import { Wait, type WaitShape } from "../../flash/Services/Wait";
import { World, type WorldShape } from "../../flash/Services/World";
import { ScriptRunner } from "../Services/ScriptRunner";
import type { ScriptRunnerShape } from "../Services/ScriptRunner";
import type { ScriptDiagnostic } from "../Types";
import { ScriptRunnerLive } from "./ScriptRunner";

class ScriptRunnerEventTestError extends Data.TaggedError(
  "ScriptRunnerEventTestError",
)<{
  readonly cause?: unknown;
  readonly message: string;
}> {}

type HandlerStore = {
  [K in GameEvent]?: Set<GameEventHandler<K>>;
};

const makeGameEvents = (): GameEventsShape => {
  const handlers: HandlerStore = {};

  return {
    started: true,
    on(event, handler) {
      return Effect.sync(() => {
        const registered =
          (handlers[event] as Set<typeof handler> | undefined) ??
          new Set<typeof handler>();
        registered.add(handler);
        handlers[event] = registered as HandlerStore[typeof event];

        let disposed = false;
        return () => {
          if (disposed) {
            return;
          }

          disposed = true;
          registered.delete(handler);
        };
      });
    },
    emit(event, payload) {
      const registered = handlers[event] as
        | Set<GameEventHandler<typeof event>>
        | undefined;
      return Effect.forEach(
        registered ? Array.from(registered) : [],
        (handler) =>
          handler(payload).pipe(Effect.catchCause(() => Effect.void)),
        { discard: true },
      ).pipe(Effect.asVoid);
    },
  };
};

const makeEffectProxy = <A>(): A => {
  const cache = new Map<PropertyKey, unknown>();
  return new Proxy(() => Effect.succeed(undefined), {
    apply() {
      return Effect.succeed(undefined);
    },
    get(_target, property) {
      if (property === "then") {
        return undefined;
      }

      const cached = cache.get(property);
      if (cached !== undefined) {
        return cached;
      }

      const value = makeEffectProxy<unknown>();
      cache.set(property, value);
      return value;
    },
  }) as A;
};

const makeEffectProxyWithOverrides = <A extends object>(
  overrides: Readonly<Record<PropertyKey, unknown>>,
): A => {
  const base = makeEffectProxy<A>();
  return new Proxy(base as object, {
    get(target, property, receiver) {
      if (property in overrides) {
        return overrides[property];
      }

      return Reflect.get(target, property, receiver);
    },
  }) as A;
};

const extensionPacket = (cmd = "event") => ({
  cmd,
  data: {},
  packetType: "json" as const,
  raw: "",
  type: "extension" as const,
});

const makeAuth = (): AuthShape => ({
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
      unm: "Hero",
    }),
  getPassword: () => Effect.succeed("password"),
  getServers: () => Effect.succeed([]),
  getUsername: () => Effect.succeed("Hero"),
  isLoggedIn: () => Effect.succeed(true),
  isTemporarilyKicked: () => Effect.succeed(false),
  login: () => Effect.void,
  logout: () => Effect.void,
});

const makeBridge = (): BridgeShape => ({
  call: () => Effect.succeed(undefined as never),
  callGameFunction: () => Effect.succeed(undefined),
  onConnection(handler) {
    return Effect.sync(() => {
      handler("OnConnection");
      return () => undefined;
    });
  },
});

const makeWindow = () =>
  ({
    ipc: {
      scripting: {
        onExecute: () => () => undefined,
        onStop: () => () => undefined,
      },
      windows: {
        requestCloseGameWindow: () => undefined,
      },
    },
    swf: {},
  }) as unknown as Window;

const makeRuntimeLayer = (
  events: GameEventsShape,
  overrides?: {
    readonly bridge?: BridgeShape;
    readonly combat?: CombatShape;
    readonly packet?: PacketShape;
    readonly player?: PlayerShape;
    readonly wait?: WaitShape;
    readonly world?: WorldShape;
  },
) =>
  ScriptRunnerLive.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(Army)(makeEffectProxy()),
        Layer.succeed(Auth)(makeAuth()),
        Layer.succeed(AutoRelogin)(makeEffectProxy()),
        Layer.succeed(AutoZone)(makeEffectProxy()),
        Layer.succeed(Bank)(makeEffectProxy()),
        Layer.succeed(Bridge)(overrides?.bridge ?? makeBridge()),
        Layer.succeed(Combat)(overrides?.combat ?? makeEffectProxy()),
        Layer.succeed(Drops)(makeEffectProxy()),
        Layer.succeed(Environment)(makeEffectProxy()),
        Layer.succeed(GameEvents)(events),
        Layer.succeed(House)(makeEffectProxy()),
        Layer.succeed(Inventory)(makeEffectProxy()),
        Layer.succeed(Outfits)(makeEffectProxy()),
        Layer.succeed(Packet)(overrides?.packet ?? makeEffectProxy()),
        Layer.succeed(Player)(overrides?.player ?? makeEffectProxy()),
        Layer.succeed(Quests)(makeEffectProxy()),
        Layer.succeed(Settings)(makeEffectProxy()),
        Layer.succeed(Shops)(makeEffectProxy()),
        Layer.succeed(TempInventory)(makeEffectProxy()),
        Layer.succeed(Wait)(overrides?.wait ?? makeEffectProxy()),
        Layer.succeed(World)(overrides?.world ?? makeEffectProxy()),
      ),
    ),
  );

const withRunnerEvents = async <A>(
  body: (
    runner: ScriptRunnerShape,
    events: GameEventsShape,
  ) => Effect.Effect<A, unknown>,
  overrides?: {
    readonly bridge?: BridgeShape;
    readonly combat?: CombatShape;
    readonly packet?: PacketShape;
    readonly player?: PlayerShape;
    readonly wait?: WaitShape;
    readonly world?: WorldShape;
  },
): Promise<A> => {
  const hadWindow = "window" in globalThis;
  const previousWindow = globalThis.window;
  const events = makeGameEvents();

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: makeWindow(),
  });

  try {
    return await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runner = yield* ScriptRunner;
          yield* Effect.sleep("10 millis");
          return yield* body(runner, events);
        }),
      ).pipe(Effect.provide(makeRuntimeLayer(events, overrides))),
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

const waitForDiagnostics = (
  runner: ScriptRunnerShape,
  predicate: (diagnostics: readonly ScriptDiagnostic[]) => boolean,
): Effect.Effect<readonly ScriptDiagnostic[], ScriptRunnerEventTestError> =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const diagnostics = yield* runner.diagnostics();
      if (predicate(diagnostics)) {
        return diagnostics;
      }

      yield* Effect.sleep("10 millis");
    }

    return yield* new ScriptRunnerEventTestError({
      message: "timed out waiting for script diagnostics",
    });
  });

const waitUntilNotRunning = (
  runner: ScriptRunnerShape,
): Effect.Effect<void, ScriptRunnerEventTestError> =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (!(yield* runner.isRunning())) {
        return;
      }

      yield* Effect.sleep("10 millis");
    }

    return yield* new ScriptRunnerEventTestError({
      message: "timed out waiting for script to stop",
    });
  });

const diagnosticMessages = (diagnostics: readonly ScriptDiagnostic[]) =>
  diagnostics.map((diagnostic) => diagnostic.message);

const makeSafeStartStopOverrides = (
  calls: string[],
  options?: {
    readonly failHousePacket?: boolean;
    readonly leaveHouseAfterTransfer?: boolean;
  },
) => {
  let inHouse = false;
  const world = makeEffectProxy<WorldShape>();
  const map = makeEffectProxyWithOverrides<WorldShape["map"]>({
    getName: () => Effect.succeed(inHouse ? "house" : "battleon"),
    isLoaded: () => Effect.succeed(true),
  });
  const call = ((method: string) =>
    method === "flash.getGameObject"
      ? Effect.succeed((inHouse ? { unm: "Hero" } : undefined) as never)
      : Effect.succeed(undefined as never)) as BridgeShape["call"];
  const until = ((condition) => condition) as WaitShape["until"];

  return {
    bridge: {
      ...makeBridge(),
      call,
    } satisfies BridgeShape,
    combat: makeEffectProxyWithOverrides<CombatShape>({
      exit: () => Effect.succeed(true),
    }),
    packet: makeEffectProxyWithOverrides<PacketShape>({
      sendServer: (packet: string) =>
        Effect.suspend(() => {
          calls.push(packet);
          if (options?.failHousePacket) {
            return Effect.fail(
              new ScriptRunnerEventTestError({
                message: "house packet failed",
              }),
            );
          }

          inHouse = !options?.leaveHouseAfterTransfer;
          return Effect.void;
        }),
    }),
    player: makeEffectProxyWithOverrides<PlayerShape>({
      isReady: () => Effect.succeed(true),
    }),
    wait: makeEffectProxyWithOverrides<WaitShape>({
      forGameAction: () => Effect.succeed(true),
      until,
    }),
    world: new Proxy(world as object, {
      get(target, property, receiver) {
        if (property === "map") {
          return map;
        }

        return Reflect.get(target, property, receiver);
      },
    }) as WorldShape,
  };
};

test("script safeStartStop option defaults false and resets through script API", async () => {
  const diagnostics = await withRunnerEvents((runner) =>
    Effect.gen(function* () {
      const initialOptions = yield* runner.getOptions();
      expect(initialOptions.safeStartStop).toBe(false);

      yield* runner.run(
        `
const { script } = require("lucent");

module.exports = function* run() {
  script.log(JSON.stringify(yield* script.options.getAll()));
  yield* script.options.setSafeStartStop(true);
  script.log(String(yield* script.options.getSafeStartStop()));
  yield* script.options.reset();
  script.log(JSON.stringify(yield* script.options.getAll()));
};
`,
        { name: "safe-start-stop-options" },
      );

      const diagnostics = yield* waitForDiagnostics(runner, (diagnostics) => {
        const messages = diagnosticMessages(diagnostics);
        const falseOptionMessages = messages.filter((message) =>
          message.includes('"safeStartStop":false'),
        );
        return (
          messages.includes("true") &&
          falseOptionMessages.length >= 2
        );
      });
      yield* waitUntilNotRunning(runner);
      return diagnostics;
    }),
  );

  const messages = diagnosticMessages(diagnostics);
  expect(messages[0]).toContain('"safeStartStop":false');
  expect(messages).toContain("true");
  expect(messages.at(-1)).toContain('"safeStartStop":false');
});

test("safeStartStop moves to house before script body and after completion", async () => {
  const calls: string[] = [];
  await withRunnerEvents(
    (runner) =>
      Effect.gen(function* () {
        yield* runner.setSafeStartStop(true);
        yield* runner.run(
          `
const { script } = require("lucent");

module.exports = function* run() {
  script.log("body");
};
`,
          { name: "safe-start-stop-house" },
        );

        yield* waitForDiagnostics(runner, (diagnostics) =>
          diagnosticMessages(diagnostics).includes("body"),
        );
        expect(calls[0]).toBe("%xt%zm%house%1%Hero%");
        yield* waitUntilNotRunning(runner);
      }),
    makeSafeStartStopOverrides(calls, { leaveHouseAfterTransfer: true }),
  );

  expect(calls).toEqual([
    "%xt%zm%house%1%Hero%",
    "%xt%zm%house%1%Hero%",
  ]);
});

test("safeStartStop records house failures as warnings and continues", async () => {
  const calls: string[] = [];
  const diagnostics = await withRunnerEvents(
    (runner) =>
      Effect.gen(function* () {
        yield* runner.setSafeStartStop(true);
        yield* runner.run(
          `
const { script } = require("lucent");

module.exports = function* run() {
  script.log("body");
};
`,
          { name: "safe-start-stop-failure" },
        );

        const diagnostics = yield* waitForDiagnostics(runner, (diagnostics) => {
          const messages = diagnosticMessages(diagnostics);
          return (
            messages.includes("body") &&
            messages.some((message) =>
              message.includes("Safe start failed to move to house"),
            )
          );
        });
        yield* waitUntilNotRunning(runner);
        return diagnostics;
      }),
    makeSafeStartStopOverrides(calls, { failHousePacket: true }),
  );

  const messages = diagnosticMessages(diagnostics);
  expect(messages).toContain("body");
  expect(messages.some((message) =>
    message.includes("Safe start failed to move to house"),
  )).toBe(true);
});

const makeMissingWorld = (): WorldShape =>
  ({
    map: {
      getCells: () => Effect.succeed([]),
      getCellPads: () => Effect.succeed([]),
      getId: () => Effect.succeed(0),
      getMapItem: () => Effect.void,
      getName: () => Effect.succeed(""),
      getRoomNumber: () => Effect.succeed(0),
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
      getAura: () => Effect.succeed(Option.none()),
      getAuras: () => Effect.succeed(new Collection()),
      getAll: () => Effect.succeed(new Collection()),
      getByName: () => Effect.succeed(Option.none()),
      getSelf: () => Effect.succeed(Option.none()),
      get: () => Effect.succeed(Option.none()),
      register: () => Effect.void,
      remove: () => Effect.void,
      removeAura: () => Effect.void,
      setSelf: () => Effect.void,
      unregister: () => Effect.void,
      updateAura: () => Effect.void,
      withSelf: () => Effect.succeed(Option.none()),
      auras: {
        getAll: () => Effect.succeed(new Collection()),
        get: () => Effect.succeed(Option.none()),
        has: () => Effect.succeed(false),
      },
    },
    monsters: {
      add: () => Effect.void,
      addAura: () => Effect.void,
      clearAuras: () => Effect.void,
      findByName: () => Effect.succeed(Option.none()),
      getAura: () => Effect.succeed(Option.none()),
      getAuras: () => Effect.succeed(new Collection()),
      getAll: () => Effect.succeed(new Collection()),
      get: () => Effect.succeed(Option.none()),
      getAvailable: () => Effect.succeed(new Collection()),
      isAvailable: () => Effect.succeed(false),
      removeAura: () => Effect.void,
      updateAura: () => Effect.void,
      auras: {
        getAll: () => Effect.succeed(new Collection()),
        get: () => Effect.succeed(Option.none()),
        has: () => Effect.succeed(false),
      },
    },
    entities: {
      getAll: () => Effect.succeed(new Collection()),
      getMe: () => Effect.succeed(Option.none()),
      get: () => Effect.succeed(Option.none()),
    },
  }) as WorldShape;

test("script facade converts missing lookups to null and removes top-level outfits", async () => {
  const diagnostics = await withRunnerEvents(
    (runner) =>
      Effect.gen(function* () {
        yield* runner.run(
          `
const { api, script } = require("lucent");

module.exports = function* run() {
  const missing = yield* api.world.players.get("Missing");
  script.log("missing-player:" + (missing === null));
  script.log("top-outfits:" + (api.outfits === undefined));
  script.log("player-outfits:" + (api.player.outfits !== undefined));
};
`,
          { name: "facade-null" },
        );

        return yield* waitForDiagnostics(
          runner,
          (diagnostics) =>
            diagnosticMessages(diagnostics).includes("missing-player:true") &&
            diagnosticMessages(diagnostics).includes("top-outfits:true") &&
            diagnosticMessages(diagnostics).includes("player-outfits:true"),
        );
      }),
    { world: makeMissingWorld() },
  );

  expect(diagnosticMessages(diagnostics)).toContain("missing-player:true");
  expect(diagnosticMessages(diagnostics)).toContain("top-outfits:true");
  expect(diagnosticMessages(diagnostics)).toContain("player-outfits:true");
});

test("script events on dispatches normalized semantic payloads", async () => {
  const diagnostics = await withRunnerEvents((runner, events) =>
    Effect.gen(function* () {
      yield* runner.run(
        `
const { api, script } = require("lucent");

module.exports = function* run() {
  yield* api.events.on("monsterDeath", (event) => {
    script.log("death:" + event.monMapId);
  });
  script.log("ready");
  yield* script.sleep(200);
};
`,
        { name: "events-on" },
      );

      yield* waitForDiagnostics(runner, (diagnostics) =>
        diagnosticMessages(diagnostics).includes("ready"),
      );
      yield* events.emit("monsterDeath", {
        monMapId: 7,
        packet: extensionPacket("addGoldExp"),
      });

      const diagnostics = yield* waitForDiagnostics(runner, (diagnostics) =>
        diagnosticMessages(diagnostics).includes("death:7"),
      );
      yield* runner.stop("test complete");
      return diagnostics;
    }),
  );

  expect(diagnosticMessages(diagnostics)).toContain("death:7");
});

test("script events expose normalized player death payloads", async () => {
  const diagnostics = await withRunnerEvents((runner, events) =>
    Effect.gen(function* () {
      yield* runner.run(
        `
const { api, script } = require("lucent");

module.exports = function* run() {
  yield* api.events.on("playerDeath", (event) => {
    script.log(
      "player-death:" +
        event.username +
        ":" +
        event.entId +
        ":" +
        event.cell +
        ":" +
        event.pad +
        ":" +
        event.hp +
        ":" +
        event.state,
    );
  });
  script.log("ready");
  const death = yield* api.events.waitFor("playerDeath", {
    timeout: "200 millis",
  });
  script.log(
    death === null
      ? "wait-player-death:timeout"
      : "wait-player-death:" + death.username,
  );
  yield* script.sleep(200);
};
`,
        { name: "events-player-death" },
      );

      yield* waitForDiagnostics(runner, (diagnostics) =>
        diagnosticMessages(diagnostics).includes("ready"),
      );
      yield* events.emit("playerDeath", {
        cell: "Boss",
        entId: 9,
        hp: 0,
        packet: {
          cmd: "ct",
          data: {},
          raw: "",
          type: "server",
        },
        pad: "Left",
        state: 0,
        username: "Hero",
      });

      const diagnostics = yield* waitForDiagnostics(runner, (diagnostics) =>
        diagnosticMessages(diagnostics).includes(
          "player-death:Hero:9:Boss:Left:0:0",
        ) &&
        diagnosticMessages(diagnostics).includes("wait-player-death:Hero"),
      );
      yield* runner.stop("test complete");
      return diagnostics;
    }),
  );

  expect(diagnosticMessages(diagnostics)).toContain(
    "player-death:Hero:9:Boss:Left:0:0",
  );
  expect(diagnosticMessages(diagnostics)).toContain("wait-player-death:Hero");
});

test("script events once disposes after the first matching event", async () => {
  const diagnostics = await withRunnerEvents((runner, events) =>
    Effect.gen(function* () {
      yield* runner.run(
        `
const { api, script } = require("lucent");

module.exports = function* run() {
  yield* api.events.once("monsterDeath", (event) => {
    script.log("once:" + event.monMapId);
  });
  script.log("ready");
  yield* script.sleep(200);
};
`,
        { name: "events-once" },
      );

      yield* waitForDiagnostics(runner, (diagnostics) =>
        diagnosticMessages(diagnostics).includes("ready"),
      );
      yield* events.emit("monsterDeath", {
        monMapId: 1,
        packet: extensionPacket("addGoldExp"),
      });
      yield* events.emit("monsterDeath", {
        monMapId: 2,
        packet: extensionPacket("addGoldExp"),
      });
      yield* Effect.sleep("50 millis");

      const diagnostics = yield* runner.diagnostics();
      yield* runner.stop("test complete");
      return diagnostics;
    }),
  );

  expect(diagnosticMessages(diagnostics).filter((message) =>
    message.startsWith("once:"),
  )).toEqual(["once:1"]);
});

test("script events waitFor supports predicates and timeout", async () => {
  const diagnostics = await withRunnerEvents((runner, events) =>
    Effect.gen(function* () {
      yield* runner.run(
        `
const { api, script } = require("lucent");

module.exports = function* run() {
  script.log("ready");
  const quest = yield* api.events.waitFor("questComplete", {
    timeout: "200 millis",
    predicate: (event) => event.QuestID === 42,
  });
  script.log(quest === null ? "quest:timeout" : "quest:" + quest.QuestID);

  const afk = yield* api.events.waitFor("afk", { timeout: "10 millis" });
  script.log(afk === null ? "afk:timeout" : "afk:unexpected");
};
`,
        { name: "events-wait-for" },
      );

      yield* waitForDiagnostics(runner, (diagnostics) =>
        diagnosticMessages(diagnostics).includes("ready"),
      );
      yield* events.emit("questComplete", {
        QuestID: 1,
        bSuccess: 1,
        packet: extensionPacket("ccqr"),
        rewardObj: {},
        sName: "Other Quest",
      });
      yield* events.emit("questComplete", {
        QuestID: 42,
        bSuccess: 1,
        packet: extensionPacket("ccqr"),
        rewardObj: {
          iCP: 0,
          intCoins: 0,
          intExp: 0,
          intGold: 0,
          typ: "q",
        },
        sName: "Twilly's New Staff",
      });

      return yield* waitForDiagnostics(runner, (diagnostics) => {
        const messages = diagnosticMessages(diagnostics);
        return messages.includes("quest:42") && messages.includes("afk:timeout");
      });
    }),
  );

  expect(diagnosticMessages(diagnostics)).toEqual(
    expect.arrayContaining(["quest:42", "afk:timeout"]),
  );
});

test("script event subscriptions are cleaned up when scripts finish", async () => {
  const diagnostics = await withRunnerEvents((runner, events) =>
    Effect.gen(function* () {
      yield* runner.run(
        `
const { api, script } = require("lucent");

module.exports = function* run() {
  yield* api.events.on("monsterDeath", () => {
    script.log("late-event");
  });
  script.log("registered");
};
`,
        { name: "events-cleanup" },
      );

      yield* waitForDiagnostics(runner, (diagnostics) =>
        diagnosticMessages(diagnostics).includes("registered"),
      );
      yield* waitUntilNotRunning(runner);
      yield* events.emit("monsterDeath", {
        monMapId: 7,
        packet: extensionPacket("addGoldExp"),
      });
      yield* Effect.sleep("50 millis");

      return yield* runner.diagnostics();
    }),
  );

  expect(diagnosticMessages(diagnostics)).not.toContain("late-event");
});

test("script event handler failures become diagnostics without unsubscribing", async () => {
  const diagnostics = await withRunnerEvents((runner, events) =>
    Effect.gen(function* () {
      yield* runner.run(
        `
const { api, script } = require("lucent");
const { Effect } = require("effect");

module.exports = function* run() {
  yield* api.events.on("monsterDeath", function* (event) {
    script.log("attempt:" + event.monMapId);
    yield* Effect.fail("boom");
  });
  script.log("ready");
  yield* script.sleep(300);
};
`,
        { name: "events-diagnostics" },
      );

      yield* waitForDiagnostics(runner, (diagnostics) =>
        diagnosticMessages(diagnostics).includes("ready"),
      );
      yield* events.emit("monsterDeath", {
        monMapId: 1,
        packet: extensionPacket("addGoldExp"),
      });
      yield* events.emit("monsterDeath", {
        monMapId: 2,
        packet: extensionPacket("addGoldExp"),
      });

      const diagnostics = yield* waitForDiagnostics(runner, (diagnostics) => {
        const messages = diagnosticMessages(diagnostics);
        return (
          messages.includes("attempt:2") &&
          messages.some((message) =>
            message.includes("api.events.monsterDeath event handler failed"),
          )
        );
      });
      yield* runner.stop("test complete");
      return diagnostics;
    }),
  );

  const messages = diagnosticMessages(diagnostics);
  expect(messages).toEqual(expect.arrayContaining(["attempt:1", "attempt:2"]));
  expect(messages.some((message) =>
    message.includes("api.events.monsterDeath event handler failed"),
  )).toBe(true);
});

test("script event queues drop overflow with diagnostics", async () => {
  const diagnostics = await withRunnerEvents((runner, events) =>
    Effect.gen(function* () {
      yield* runner.run(
        `
const { api, script } = require("lucent");

module.exports = function* run() {
  yield* api.events.on("packetFromClient", function* () {
    yield* script.sleep(500);
  });
  script.log("ready");
  yield* script.sleep(500);
};
`,
        { name: "events-overflow" },
      );

      yield* waitForDiagnostics(runner, (diagnostics) =>
        diagnosticMessages(diagnostics).includes("ready"),
      );

      for (let index = 0; index < 2_000; index += 1) {
        yield* events.emit("packetFromClient", `%xt%zm%mv%1%${index}%0%`);
      }

      const diagnostics = yield* waitForDiagnostics(runner, (diagnostics) =>
        diagnosticMessages(diagnostics).some((message) =>
          message.includes("Dropped api.events.packetFromClient callback event"),
        ),
      );
      yield* runner.stop("test complete");
      return diagnostics;
    }),
  );

  expect(diagnosticMessages(diagnostics).some((message) =>
    message.includes("Dropped api.events.packetFromClient callback event"),
  )).toBe(true);
});
