import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";
import * as TestClock from "effect/testing/TestClock";
import { LiveServer } from "@lucent/game";

import { AuthApi, type AuthApiShape } from "../api/Auth";
import { EventsApi, type EventsApiShape } from "../api/Events";
import { PlayerApi, type PlayerApiShape } from "../api/Player";
import { WaitApi, type WaitApiShape } from "../api/Wait";
import type { FlashEvent } from "../Types";
import { matchesEventSelector } from "../protocol/PacketSelectors";
import {
  AutoRelogin,
  type AutoReloginLifecycleEvent,
  layer as AutoReloginLayer,
  normalizeAutoReloginDelay,
} from "./AutoRelogin";

const connectionEvent = (status: string): FlashEvent => ({
  kind: "runtime",
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
});

interface HarnessControls {
  connectMakesReady: boolean;
  connectResult: AuthApiShape["connectTo"];
  loginReady: boolean;
  loggedIn: boolean;
  password: string;
  ready: boolean;
  username: string;
}

const makeHarness = (overrides: Partial<HarnessControls> = {}) => {
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
    username: "Hero",
    ...overrides,
  };
  const handlers: Array<{
    readonly handler: (event: FlashEvent) => Effect.Effect<void>;
    readonly selector: Parameters<EventsApiShape["on"]>[0];
  }> = [];
  const connectCalls: string[] = [];
  let loginCalls = 0;
  let logoutCalls = 0;

  const events = EventsApi.of({
    on: (selector, handler) =>
      Effect.sync(() => {
        const entry = { handler, selector };
        handlers.push(entry);
        return () => {
          const index = handlers.indexOf(entry);
          if (index >= 0) handlers.splice(index, 1);
        };
      }),
  } as EventsApiShape);
  const auth = AuthApi.of({
    connectTo: (server) =>
      Effect.gen(function* () {
        connectCalls.push(server);
        const result = yield* controls.connectResult(server);
        if (controls.connectMakesReady) {
          controls.loggedIn = true;
          controls.ready = true;
        }
        return result;
      }),
    getPassword: () => Effect.sync(() => controls.password),
    getServers: () =>
      Effect.succeed([
        new LiveServer({
          chat: 1,
          count: 1,
          language: "en",
          max: 100,
          memberOnly: false,
          name: "Artix",
          online: true,
        }),
      ]),
    getUsername: () => Effect.sync(() => controls.username),
    isLoggedIn: () => Effect.sync(() => controls.loggedIn),
    isServerSelectReady: () => Effect.succeed(false),
    isTemporarilyKicked: () => Effect.succeed(false),
    login: () =>
      Effect.sync(() => {
        loginCalls += 1;
        return controls.loginReady;
      }),
    logout: () =>
      Effect.sync(() => {
        logoutCalls += 1;
        controls.loggedIn = false;
        controls.ready = false;
      }),
  } as AuthApiShape);
  const player = PlayerApi.of({
    isReady: () => Effect.sync(() => controls.ready),
  } as PlayerApiShape);
  const wait = WaitApi.of({
    until: (condition) => condition,
    untilSome: (condition) =>
      condition.pipe(
        Effect.map((result) => (Option.isSome(result) ? result.value : null)),
      ),
  } as WaitApiShape);
  const emit = (event: FlashEvent) =>
    Effect.forEach(
      handlers,
      ({ handler, selector }) =>
        matchesEventSelector(event, selector) ? handler(event) : Effect.void,
      { discard: true },
    );
  const layer = AutoReloginLayer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        Layer.succeed(AuthApi, auth),
        Layer.succeed(EventsApi, events),
        Layer.succeed(PlayerApi, player),
        Layer.succeed(WaitApi, wait),
      ),
    ),
  );

  return {
    connectCalls,
    emit,
    layer,
    loginCalls: () => loginCalls,
    logoutCalls: () => logoutCalls,
    setCredentials: (username: string, password: string) => {
      controls.username = username;
      controls.password = password;
    },
    setReady: (ready: boolean) => {
      controls.ready = ready;
      controls.loggedIn = ready || controls.loggedIn;
    },
  };
};

const withClock = (harness: ReturnType<typeof makeHarness>) =>
  harness.layer.pipe(Layer.provideMerge(TestClock.layer()));

describe("AutoRelogin", () => {
  it.effect(
    "captures valid credentials and preserves the selected server",
    () =>
      Effect.gen(function* () {
        const harness = makeHarness();
        yield* Effect.scoped(
          Effect.gen(function* () {
            const autoRelogin = yield* AutoRelogin;
            yield* autoRelogin.setServer("artix");
            const state = yield* autoRelogin.enable();

            expect(state).toMatchObject({
              captured: true,
              enabled: true,
              server: "Artix",
              username: "Hero",
            });
          }).pipe(Effect.provide(harness.layer)),
        );
      }),
  );

  it.effect("captures a later ready session after empty credentials", () =>
    Effect.gen(function* () {
      const harness = makeHarness({ password: "", username: "" });
      yield* Effect.scoped(
        Effect.gen(function* () {
          const autoRelogin = yield* AutoRelogin;
          expect(yield* autoRelogin.enable()).toMatchObject({
            captured: false,
            lastError: "current session is not capturable",
          });

          harness.setCredentials("Hero", "pw");
          harness.setReady(true);
          yield* harness.emit(connectionEvent("OnConnection"));
          yield* Effect.yieldNow;

          expect(yield* autoRelogin.getState()).toMatchObject({
            captured: true,
            enabled: true,
            username: "Hero",
          });
          expect((yield* autoRelogin.getState()).lastError).toBeUndefined();
        }).pipe(Effect.provide(harness.layer)),
      );
    }),
  );

  it.effect(
    "runs explicit ready and server-select logins without enabling",
    () =>
      Effect.gen(function* () {
        const readyHarness = makeHarness({ connectMakesReady: true });
        const lifecycle: AutoReloginLifecycleEvent[] = [];
        yield* Effect.scoped(
          Effect.gen(function* () {
            const autoRelogin = yield* AutoRelogin;
            expect(
              yield* autoRelogin.runLogin({
                onLifecycle: (event) =>
                  Effect.sync(() => {
                    lifecycle.push(event);
                  }),
                password: "pw",
                server: "Artix",
                username: "Hero",
              }),
            ).toEqual({ status: "ready" });
            expect(lifecycle.map(({ step }) => step)).toEqual([
              "login",
              "connect",
            ]);
            expect(yield* autoRelogin.getState()).toMatchObject({
              attempting: false,
              captured: false,
              enabled: false,
            });
          }).pipe(Effect.provide(readyHarness.layer)),
        );

        const selectHarness = makeHarness();
        yield* Effect.scoped(
          Effect.gen(function* () {
            const autoRelogin = yield* AutoRelogin;
            expect(
              yield* autoRelogin.runLogin({
                password: "pw",
                username: "Hero",
              }),
            ).toEqual({ status: "server-select" });
            expect(selectHarness.connectCalls).toEqual([]);
          }).pipe(Effect.provide(selectHarness.layer)),
        );
      }),
  );

  it("normalizes configured delays", () => {
    expect([
      normalizeAutoReloginDelay(-1),
      normalizeAutoReloginDelay(2_000),
      normalizeAutoReloginDelay(400_000),
      normalizeAutoReloginDelay(Number.NaN),
    ]).toEqual([0, 2_000, 300_000, 3_000]);
  });

  it.effect(
    "stays idle without a server, then waits the configured delay",
    () =>
      Effect.gen(function* () {
        const harness = makeHarness();
        yield* Effect.scoped(
          Effect.gen(function* () {
            const autoRelogin = yield* AutoRelogin;
            yield* autoRelogin.enable();
            yield* harness.emit(connectionEvent("OnConnectionLost"));
            yield* advance("10 seconds");

            expect(harness.loginCalls()).toBe(0);
            expect((yield* autoRelogin.getState()).waitingDelay).toBe(false);

            yield* autoRelogin.setServer("Artix");
            yield* harness.emit(connectionEvent("OnConnectionLost"));

            yield* advance("2 seconds");
            expect(harness.loginCalls()).toBe(0);
            expect((yield* autoRelogin.getState()).waitingDelay).toBe(true);

            yield* advance("2 seconds");
            expect(harness.loginCalls()).toBe(1);
            expect(harness.connectCalls).toEqual(["Artix"]);
          }).pipe(Effect.provide(withClock(harness))),
        );
      }),
  );

  it.effect("treats readiness before or during connection as success", () =>
    Effect.gen(function* () {
      const beforeHarness = makeHarness();
      yield* Effect.scoped(
        Effect.gen(function* () {
          const autoRelogin = yield* AutoRelogin;
          yield* autoRelogin.setServer("Artix");
          yield* autoRelogin.enable();
          yield* beforeHarness.emit(connectionEvent("OnConnectionLost"));
          beforeHarness.setReady(true);
          yield* advance();

          expect(beforeHarness.loginCalls()).toBe(0);
          expect(yield* autoRelogin.getState()).toMatchObject({
            attempting: false,
            enabled: true,
            waitingDelay: false,
          });
        }).pipe(Effect.provide(withClock(beforeHarness))),
      );

      const duringHarness = makeHarness({
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
          yield* duringHarness.emit(connectionEvent("OnConnectionLost"));
          yield* advance();

          expect(duringHarness.connectCalls).toEqual(["Artix"]);
          expect(duringHarness.logoutCalls()).toBe(0);
          expect((yield* autoRelogin.getState()).attempting).toBe(false);
        }).pipe(Effect.provide(withClock(duringHarness))),
      );
    }),
  );

  it.effect("logs out and retries when connected but not ready", () =>
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
          yield* advance("5 seconds");

          expect(harness.loginCalls()).toBe(2);
          expect(harness.logoutCalls()).toBe(2);
          expect(yield* autoRelogin.getState()).toMatchObject({
            attemptsRemaining: 1,
            attempting: true,
            lastError: "player did not become ready",
          });
        }).pipe(Effect.provide(withClock(harness))),
      );
    }),
  );

  it.effect(
    "stops after retry exhaustion and rearms after configuration or readiness",
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

            expect(harness.loginCalls()).toBe(4);
            expect(yield* autoRelogin.getState()).toMatchObject({
              attemptsRemaining: 0,
              attempting: false,
              lastError: "login did not reach server selection",
            });

            const rearmed = yield* autoRelogin.setServer("Artix");
            expect(rearmed).toMatchObject({
              attempting: false,
              enabled: true,
              waitingDelay: true,
            });
            expect(rearmed.lastError).toBeUndefined();

            yield* advance();
            expect(harness.loginCalls()).toBe(5);

            harness.setReady(true);
            yield* advance("5 seconds");
            expect((yield* autoRelogin.getState()).lastError).toBeUndefined();
            expect((yield* autoRelogin.getState()).attempting).toBe(false);

            harness.setReady(false);
            yield* harness.emit(connectionEvent("OnConnectionLost"));
            yield* advance();
            expect(harness.loginCalls()).toBe(6);
          }).pipe(Effect.provide(withClock(harness))),
        );
      }),
  );
});
