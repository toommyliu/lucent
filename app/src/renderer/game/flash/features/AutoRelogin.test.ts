import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";
import * as TestClock from "effect/testing/TestClock";

import { AuthApi, type AuthApiShape } from "../api/Auth";
import { EventsApi, type EventsApiShape } from "../api/Events";
import { PlayerApi, type PlayerApiShape } from "../api/Player";
import { WaitApi, type WaitApiShape } from "../api/Wait";
import type { FlashEvent } from "../Types";
import { matchesEventSelector } from "../protocol/PacketSelectors";
import { AutoRelogin, layer as AutoReloginLayer } from "./AutoRelogin";

const connectionEvent = (status: string): FlashEvent => ({
  payload: { status },
  type: "connection",
});

const advance = (
  duration: Parameters<typeof TestClock.adjust>[0] = "1 second",
) =>
  Effect.gen(function* () {
    yield* TestClock.adjust(duration);
    yield* Effect.yieldNow;
  });

const exhaustRetries = Effect.gen(function* () {
  yield* advance();
  yield* advance("5 seconds");
  yield* advance("10 seconds");
  yield* advance("20 seconds");
  yield* Effect.yieldNow;
});

interface HarnessControls {
  connectMakesReady: boolean;
  connectResult: AuthApiShape["connectTo"];
  loginReady: boolean;
  loggedIn: boolean;
  password: string;
  ready: boolean;
  serverSelectReady: boolean;
  username: string;
}

const makeHarness = (
  overrides: Partial<HarnessControls> = {},
): {
  readonly connectCalls: readonly string[];
  readonly emit: (event: FlashEvent) => Effect.Effect<void>;
  readonly layer: Layer.Layer<
    AutoRelogin | AuthApi | EventsApi | PlayerApi | WaitApi
  >;
  readonly loginCalls: () => number;
  readonly logoutCalls: () => number;
  readonly passwordReads: () => number;
  readonly setCredentials: (username: string, password: string) => void;
  readonly setLoginReady: (ready: boolean) => void;
  readonly setReady: (ready: boolean) => void;
  readonly usernameReads: () => number;
} => {
  const controls: HarnessControls = {
    connectMakesReady: false,
    connectResult: (server) =>
      Effect.succeed({
        message: "connected",
        retryable: false,
        serverName: server,
        status: "connected",
      }),
    loginReady: true,
    loggedIn: true,
    password: "pw",
    ready: false,
    serverSelectReady: false,
    username: "Hero",
    ...overrides,
  };
  const handlers: Array<{
    readonly handler: (event: FlashEvent) => Effect.Effect<void>;
    readonly selector: Parameters<EventsApiShape["on"]>[0];
  }> = [];
  const connectCalls: string[] = [];
  let loginCount = 0;
  let logoutCount = 0;
  let passwordReadCount = 0;
  let usernameReadCount = 0;

  const events = EventsApi.of({
    on: (selector, handler) =>
      Effect.sync(() => {
        handlers.push({ handler, selector });
        return () => {
          const index = handlers.findIndex(
            (entry) => entry.handler === handler,
          );
          if (index >= 0) {
            handlers.splice(index, 1);
          }
        };
      }),
    once: () => Effect.succeed(null),
  } satisfies EventsApiShape);
  const emit = (event: FlashEvent) =>
    Effect.forEach(
      handlers,
      (entry) =>
        matchesEventSelector(event, entry.selector)
          ? entry.handler(event)
          : Effect.void,
      { discard: true },
    );
  const auth = AuthApi.of({
    connectTo: (server) =>
      Effect.gen(function* () {
        connectCalls.push(server);
        const result = yield* controls.connectResult(server);
        if (controls.connectMakesReady) {
          controls.ready = true;
          controls.loggedIn = true;
        }
        return result;
      }),
    getPassword: () =>
      Effect.sync(() => {
        passwordReadCount += 1;
        return controls.password;
      }),
    getServers: () =>
      Effect.succeed([
        {
          chat: 1,
          count: 1,
          language: "en",
          max: 100,
          memberOnly: false,
          name: "Artix",
          online: true,
          raw: {},
        },
      ]),
    getUsername: () =>
      Effect.sync(() => {
        usernameReadCount += 1;
        return controls.username;
      }),
    isLoggedIn: () => Effect.sync(() => controls.loggedIn),
    isServerSelectReady: () => Effect.sync(() => controls.serverSelectReady),
    isTemporarilyKicked: () => Effect.succeed(false),
    login: () =>
      Effect.sync(() => {
        loginCount += 1;
        return controls.loginReady;
      }),
    logout: () =>
      Effect.sync(() => {
        logoutCount += 1;
        controls.loggedIn = false;
        controls.ready = false;
      }),
  } satisfies AuthApiShape);
  const player = PlayerApi.of({
    auras: {
      get: () => Effect.succeed(null),
      getAll: () => Effect.succeed([]),
      has: () => Effect.succeed(false),
    },
    factions: {
      get: () => Effect.succeed(null),
      getAll: () => Effect.succeed([]),
    },
    getCell: () => Effect.succeed("Enter"),
    getClassName: () => Effect.succeed("Class"),
    getGender: () => Effect.succeed("M"),
    getGold: () => Effect.succeed(0),
    getHp: () => Effect.succeed(100),
    getLevel: () => Effect.succeed(1),
    getMaxHp: () => Effect.succeed(100),
    getMaxMp: () => Effect.succeed(100),
    getMp: () => Effect.succeed(100),
    getPad: () => Effect.succeed("Spawn"),
    getPosition: () => Effect.succeed({ x: 0, y: 0 }),
    getState: () => Effect.succeed(1),
    goToPlayer: () => Effect.void,
    hasActiveBoost: () => Effect.succeed(false),
    isAfk: () => Effect.succeed(false),
    isAlive: () => Effect.succeed(true),
    isMember: () => Effect.succeed(false),
    isReady: () => Effect.sync(() => controls.ready),
    joinMap: () => Effect.succeed(true),
    jumpToCell: () => Effect.void,
    outfits: {
      equip: () => Effect.succeed(false),
      get: () => Effect.succeed(null),
      getAll: () => Effect.succeed([]),
      wear: () => Effect.succeed(false),
    },
    rest: () => Effect.void,
    useBoost: () => Effect.succeed(false),
    walkTo: () => Effect.succeed(true),
  } satisfies PlayerApiShape);
  const wait = WaitApi.of({
    forEvent: () => Effect.succeed(null),
    forGameAction: () => Effect.succeed(true),
    forPacket: () => Effect.succeed(null),
    isGameActionAvailable: () => Effect.succeed(true),
    until: (condition) => condition,
    untilSome: (condition) =>
      condition.pipe(
        Effect.map((result) => (Option.isSome(result) ? result.value : null)),
      ),
  } satisfies WaitApiShape);

  return {
    connectCalls,
    emit,
    layer: AutoReloginLayer.pipe(
      Layer.provideMerge(
        Layer.mergeAll(
          Layer.succeed(AuthApi, auth),
          Layer.succeed(EventsApi, events),
          Layer.succeed(PlayerApi, player),
          Layer.succeed(WaitApi, wait),
        ),
      ),
    ),
    loginCalls: () => loginCount,
    logoutCalls: () => logoutCount,
    passwordReads: () => passwordReadCount,
    setCredentials: (username, password) => {
      controls.username = username;
      controls.password = password;
    },
    setLoginReady: (ready) => {
      controls.loginReady = ready;
    },
    setReady: (ready) => {
      controls.ready = ready;
      controls.loggedIn = ready || controls.loggedIn;
    },
    usernameReads: () => usernameReadCount,
  };
};

const testClockLayer = (harness: ReturnType<typeof makeHarness>) =>
  harness.layer.pipe(Layer.provideMerge(TestClock.layer()));

describe("AutoRelogin", () => {
  it.effect(
    "captures credentials through Auth reads on enable and preserves server",
    () =>
      Effect.gen(function* () {
        const harness = makeHarness();
        yield* Effect.scoped(
          Effect.gen(function* () {
            const autoRelogin = yield* AutoRelogin;
            yield* autoRelogin.setServer("Artix");
            const state = yield* autoRelogin.enable();

            expect(state.enabled).toBe(true);
            expect(state.captured).toBe(true);
            expect(state.username).toBe("Hero");
            expect(state.server).toBe("Artix");
            expect(harness.usernameReads()).toBeGreaterThan(0);
            expect(harness.passwordReads()).toBeGreaterThan(0);
          }).pipe(Effect.provide(harness.layer)),
        );
      }),
  );

  it.effect("does not capture empty credentials", () =>
    Effect.gen(function* () {
      const harness = makeHarness({ password: "", username: "" });
      yield* Effect.scoped(
        Effect.gen(function* () {
          const autoRelogin = yield* AutoRelogin;
          const state = yield* autoRelogin.enable();

          expect(state.enabled).toBe(true);
          expect(state.captured).toBe(false);
          expect(state.lastError).toBe("current session is not capturable");
        }).pipe(Effect.provide(harness.layer)),
      );
    }),
  );

  it.effect("captures a manual session on connection while enabled", () =>
    Effect.gen(function* () {
      const harness = makeHarness({ password: "", username: "" });
      yield* Effect.scoped(
        Effect.gen(function* () {
          const autoRelogin = yield* AutoRelogin;
          const initial = yield* autoRelogin.enable();
          expect(initial.captured).toBe(false);
          expect(initial.lastError).toBe("current session is not capturable");

          harness.setCredentials("Hero", "pw");
          harness.setReady(true);
          yield* harness.emit(connectionEvent("OnConnection"));
          yield* Effect.yieldNow;

          const state = yield* autoRelogin.getState();
          expect(state.enabled).toBe(true);
          expect(state.captured).toBe(true);
          expect(state.username).toBe("Hero");
          expect(state.lastError).toBeUndefined();
        }).pipe(Effect.provide(harness.layer)),
      );
    }),
  );

  it.effect("does not expose public session capture", () =>
    Effect.gen(function* () {
      const harness = makeHarness();
      yield* Effect.scoped(
        Effect.gen(function* () {
          const auth = yield* AuthApi;
          const autoRelogin = yield* AutoRelogin;

          expect("captureCurrentSession" in auth).toBe(false);
          expect("captureCurrentSession" in autoRelogin).toBe(false);
        }).pipe(Effect.provide(harness.layer)),
      );
    }),
  );

  it.effect("clamps configured delay", () =>
    Effect.gen(function* () {
      const harness = makeHarness();
      yield* Effect.scoped(
        Effect.gen(function* () {
          const autoRelogin = yield* AutoRelogin;

          expect((yield* autoRelogin.setDelay(-1)).delayMs).toBe(0);
          expect((yield* autoRelogin.setDelay(400_000)).delayMs).toBe(300_000);
        }).pipe(Effect.provide(harness.layer)),
      );
    }),
  );

  it.effect(
    "stays silently idle after disconnect when no server is selected",
    () =>
      Effect.gen(function* () {
        const harness = makeHarness();
        yield* Effect.scoped(
          Effect.gen(function* () {
            const autoRelogin = yield* AutoRelogin;
            yield* autoRelogin.enable();
            yield* harness.emit(connectionEvent("OnConnectionLost"));
            yield* advance("10 seconds");

            const state = yield* autoRelogin.getState();
            expect(harness.loginCalls()).toBe(0);
            expect(harness.connectCalls).toEqual([]);
            expect(harness.logoutCalls()).toBe(0);
            expect(state.attempting).toBe(false);
            expect(state.waitingDelay).toBe(false);
            expect(state.lastError).toBeUndefined();
          }).pipe(Effect.provide(testClockLayer(harness))),
        );
      }),
  );

  it.effect("waits the configured delay before attempting login", () =>
    Effect.gen(function* () {
      const harness = makeHarness();
      yield* Effect.scoped(
        Effect.gen(function* () {
          const autoRelogin = yield* AutoRelogin;
          yield* autoRelogin.setServer("Artix");
          yield* autoRelogin.enable();
          yield* harness.emit(connectionEvent("OnConnectionLost"));

          yield* advance("2 seconds");
          expect(harness.loginCalls()).toBe(0);
          expect((yield* autoRelogin.getState()).waitingDelay).toBe(true);

          yield* advance("2 seconds");
          expect(harness.loginCalls()).toBeGreaterThan(0);
          expect(harness.connectCalls).toEqual(["Artix"]);
        }).pipe(Effect.provide(testClockLayer(harness))),
      );
    }),
  );

  it.effect(
    "manual ready state completes an armed relogin without login calls",
    () =>
      Effect.gen(function* () {
        const harness = makeHarness();
        yield* Effect.scoped(
          Effect.gen(function* () {
            const autoRelogin = yield* AutoRelogin;
            yield* autoRelogin.setServer("Artix");
            yield* autoRelogin.enable();
            yield* harness.emit(connectionEvent("OnConnectionLost"));
            harness.setReady(true);
            yield* advance();

            const state = yield* autoRelogin.getState();
            expect(harness.loginCalls()).toBe(0);
            expect(state.enabled).toBe(true);
            expect(state.attempting).toBe(false);
            expect(state.waitingDelay).toBe(false);
            expect(state.lastError).toBeUndefined();
          }).pipe(Effect.provide(testClockLayer(harness))),
        );
      }),
  );

  it.effect(
    "server-select and socket progress do not succeed until ready",
    () =>
      Effect.gen(function* () {
        const harness = makeHarness();
        yield* Effect.scoped(
          Effect.gen(function* () {
            const autoRelogin = yield* AutoRelogin;
            yield* autoRelogin.setDelay(0);
            yield* autoRelogin.setServer("Artix");
            yield* autoRelogin.enable();
            yield* harness.emit(connectionEvent("OnConnectionLost"));
            yield* advance();

            const state = yield* autoRelogin.getState();
            expect(harness.loginCalls()).toBe(1);
            expect(harness.connectCalls).toEqual(["Artix"]);
            expect(harness.logoutCalls()).toBe(1);
            expect(state.enabled).toBe(true);
            expect(state.attempting).toBe(true);
            expect(state.attemptsRemaining).toBe(2);
            expect(state.lastError).toBe("player did not become ready");
          }).pipe(Effect.provide(testClockLayer(harness))),
        );
      }),
  );

  it.effect("manual ready during connect counts as success", () =>
    Effect.gen(function* () {
      const harness = makeHarness({
        connectMakesReady: true,
        connectResult: (server) =>
          Effect.succeed({
            message: "manual connection",
            retryable: true,
            serverName: server,
            status: "timeout",
          }),
      });
      yield* Effect.scoped(
        Effect.gen(function* () {
          const autoRelogin = yield* AutoRelogin;
          yield* autoRelogin.setDelay(0);
          yield* autoRelogin.setServer("Artix");
          yield* autoRelogin.enable();
          yield* harness.emit(connectionEvent("OnConnectionLost"));
          yield* advance();

          const state = yield* autoRelogin.getState();
          expect(harness.connectCalls).toEqual(["Artix"]);
          expect(harness.logoutCalls()).toBe(0);
          expect(state.enabled).toBe(true);
          expect(state.attempting).toBe(false);
          expect(state.lastError).toBeUndefined();
        }).pipe(Effect.provide(testClockLayer(harness))),
      );
    }),
  );

  it.effect("connected-but-unready logs out and retries", () =>
    Effect.gen(function* () {
      const harness = makeHarness();
      yield* Effect.scoped(
        Effect.gen(function* () {
          const autoRelogin = yield* AutoRelogin;
          yield* autoRelogin.setDelay(0);
          yield* autoRelogin.setServer("Artix");
          yield* autoRelogin.enable();
          yield* harness.emit(connectionEvent("OnConnectionLost"));

          yield* advance();
          expect(harness.loginCalls()).toBe(1);
          expect(harness.logoutCalls()).toBe(1);

          yield* advance("5 seconds");
          expect(harness.loginCalls()).toBe(2);
          expect(harness.logoutCalls()).toBe(2);
          const state = yield* autoRelogin.getState();
          expect(state.attempting).toBe(true);
          expect(state.lastError).toBe("player did not become ready");
        }).pipe(Effect.provide(testClockLayer(harness))),
      );
    }),
  );

  it.effect(
    "retry exhaustion stops the run and keeps the last error visible",
    () =>
      Effect.gen(function* () {
        const harness = makeHarness({ loginReady: false });
        yield* Effect.scoped(
          Effect.gen(function* () {
            const autoRelogin = yield* AutoRelogin;
            yield* autoRelogin.setDelay(0);
            yield* autoRelogin.setServer("Artix");
            yield* autoRelogin.enable();
            yield* harness.emit(connectionEvent("OnConnectionLost"));
            yield* exhaustRetries;

            const stopped = yield* autoRelogin.getState();
            expect(harness.loginCalls()).toBe(4);
            expect(harness.connectCalls).toEqual([]);
            expect(stopped.enabled).toBe(true);
            expect(stopped.attempting).toBe(false);
            expect(stopped.waitingDelay).toBe(false);
            expect(stopped.attemptsRemaining).toBe(0);
            expect(stopped.lastError).toBe(
              "login did not reach server selection",
            );

            yield* advance("60 seconds");
            expect(harness.loginCalls()).toBe(4);
          }).pipe(Effect.provide(testClockLayer(harness))),
        );
      }),
  );

  it.effect(
    "ready after stopped clears the error and re-arms future disconnects",
    () =>
      Effect.gen(function* () {
        const harness = makeHarness({ loginReady: false });
        yield* Effect.scoped(
          Effect.gen(function* () {
            const autoRelogin = yield* AutoRelogin;
            yield* autoRelogin.setDelay(0);
            yield* autoRelogin.setServer("Artix");
            yield* autoRelogin.enable();
            yield* harness.emit(connectionEvent("OnConnectionLost"));
            yield* exhaustRetries;
            expect((yield* autoRelogin.getState()).lastError).toBe(
              "login did not reach server selection",
            );

            harness.setReady(true);
            yield* advance();
            const ready = yield* autoRelogin.getState();
            expect(ready.lastError).toBeUndefined();
            expect(ready.attemptsRemaining).toBeUndefined();
            expect(ready.attempting).toBe(false);

            harness.setReady(false);
            yield* harness.emit(connectionEvent("OnConnectionLost"));
            yield* advance();
            expect(harness.loginCalls()).toBe(5);
          }).pipe(Effect.provide(testClockLayer(harness))),
        );
      }),
  );

  it.effect("setServer after stopped clears stop/error state", () =>
    Effect.gen(function* () {
      const harness = makeHarness({ loginReady: false });
      yield* Effect.scoped(
        Effect.gen(function* () {
          const autoRelogin = yield* AutoRelogin;
          yield* autoRelogin.setDelay(0);
          yield* autoRelogin.setServer("Artix");
          yield* autoRelogin.enable();
          yield* harness.emit(connectionEvent("OnConnectionLost"));
          yield* exhaustRetries;
          expect((yield* autoRelogin.getState()).lastError).toBe(
            "login did not reach server selection",
          );

          const state = yield* autoRelogin.setServer("Artix");
          expect(state.lastError).toBeUndefined();
          expect(state.attemptsRemaining).toBeUndefined();
          expect(state.attempting).toBe(false);
          expect(state.waitingDelay).toBe(true);
        }).pipe(Effect.provide(testClockLayer(harness))),
      );
    }),
  );
});
