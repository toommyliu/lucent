import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FiberMap from "effect/FiberMap";
import * as Ref from "effect/Ref";
import * as Result from "effect/Result";
import * as TestClock from "effect/testing/TestClock";

import type { Event, EventSelector } from "../flash/contract/Event";
import { makeAutoRelogin } from "./AutoRelogin";
import type { AutoReloginApi, AutoReloginLifecycleStep } from "./AutoRelogin";

interface ApiOverrides {
  readonly auth?: Partial<AutoReloginApi["auth"]>;
  readonly events?: Partial<AutoReloginApi["events"]>;
  readonly player?: Partial<AutoReloginApi["player"]>;
}

const connection = (status: string): Event => ({
  status,
  type: "connection",
});

const apiWith = (overrides: ApiOverrides = {}): AutoReloginApi => ({
  auth: {
    connectTo:
      overrides.auth?.connectTo ??
      ((server) =>
        Effect.die(new Error(`Unexpected server selection: ${server}`))),
    getPassword: overrides.auth?.getPassword ?? (() => Effect.succeed("pw")),
    getServers: overrides.auth?.getServers ?? (() => Effect.succeed([])),
    getUsername: overrides.auth?.getUsername ?? (() => Effect.succeed("Hero")),
    isLoggedIn: overrides.auth?.isLoggedIn ?? (() => Effect.succeed(false)),
    isServerSelectReady:
      overrides.auth?.isServerSelectReady ?? (() => Effect.succeed(true)),
    isTemporarilyKicked:
      overrides.auth?.isTemporarilyKicked ?? (() => Effect.succeed(false)),
    login: overrides.auth?.login ?? (() => Effect.succeed(true)),
    logout: overrides.auth?.logout ?? (() => Effect.void),
  },
  events: {
    on: overrides.events?.on ?? (() => Effect.succeed(() => undefined)),
    once: overrides.events?.once ?? (() => Effect.succeed(null)),
  },
  player: {
    isReady: overrides.player?.isReady ?? (() => Effect.succeed(false)),
  },
});

const makeConnectionEvents = () => {
  let listener: ((event: Event) => Effect.Effect<void, unknown>) | undefined;

  const on: AutoReloginApi["events"]["on"] = (
    _selector: EventSelector | undefined,
    handler: (event: Event) => Effect.Effect<void, unknown>,
  ) =>
    Effect.sync(() => {
      listener = handler;
      return () => {
        if (listener === handler) listener = undefined;
      };
    });

  return {
    emit: (status: string) => listener?.(connection(status)) ?? Effect.void,
    on,
  };
};

const advance = (duration: Parameters<typeof TestClock.adjust>[0]) =>
  Effect.gen(function* () {
    yield* TestClock.adjust(duration);
    yield* Effect.yieldNow;
  });

const makeFeature = (api: AutoReloginApi) =>
  Effect.gen(function* () {
    const fibers = yield* FiberMap.make<string>();
    return yield* makeAutoRelogin(api, fibers);
  });

describe("AutoRelogin", () => {
  it.effect("logs in before returning at server selection", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const trace: string[] = [];
        const autoRelogin = yield* makeFeature(
          apiWith({
            auth: {
              login: () =>
                Effect.sync(() => {
                  trace.push("login");
                  return true;
                }),
            },
          }),
        );

        const result = yield* autoRelogin.runLogin({
          password: "pw",
          username: "Hero",
        });

        expect(result).toEqual({ status: "server-select" });
        expect(trace).toEqual(["login"]);
        expect((yield* autoRelogin.getState()).enabled).toBe(false);
      }),
    ),
  );

  it.effect(
    "waits for the first capturable session without starting a login",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const username = yield* Ref.make("");
          const password = yield* Ref.make("");
          let loginCalls = 0;
          const autoRelogin = yield* makeFeature(
            apiWith({
              auth: {
                getPassword: () => Ref.get(password),
                getUsername: () => Ref.get(username),
                login: () =>
                  Effect.sync(() => {
                    loginCalls += 1;
                    return true;
                  }),
              },
            }),
          );
          yield* autoRelogin.setServer("Artix");

          expect(yield* autoRelogin.enable()).toMatchObject({
            captured: false,
            enabled: true,
          });

          yield* Ref.set(username, "Hero");
          yield* Ref.set(password, "pw");
          yield* advance("5 seconds");

          expect(yield* autoRelogin.getState()).toMatchObject({
            captured: true,
            enabled: true,
            server: "Artix",
            username: "Hero",
          });
          expect(loginCalls).toBe(0);
        }),
      ).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect("orchestrates login, server selection, and player readiness", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const ready = yield* Ref.make(false);
        const trace: string[] = [];
        const lifecycle: AutoReloginLifecycleStep[] = [];
        const autoRelogin = yield* makeFeature(
          apiWith({
            auth: {
              connectTo: (server) =>
                Ref.set(ready, true).pipe(
                  Effect.tap(() =>
                    Effect.sync(() => {
                      trace.push(`connect:${server}`);
                    }),
                  ),
                  Effect.as({
                    message: "server selected",
                    retryable: false,
                    serverName: server,
                    status: "connected" as const,
                  }),
                ),
              login: () =>
                Effect.sync(() => {
                  trace.push("login");
                  return true;
                }),
            },
            player: { isReady: () => Ref.get(ready) },
          }),
        );

        const result = yield* autoRelogin.runLogin({
          onLifecycle: (event) =>
            Effect.sync(() => {
              if (lifecycle.at(-1) !== event.step) lifecycle.push(event.step);
            }),
          password: "pw",
          server: "Artix",
          username: "Hero",
        });

        expect(result).toEqual({ status: "ready" });
        expect(trace).toEqual(["login", "connect:Artix"]);
        expect(lifecycle).toEqual(["login", "connect", "ready"]);
      }),
    ),
  );

  it.effect("refreshes the server list between full-server retries", () =>
    Effect.scoped(
      Effect.gen(function* () {
        let connectCalls = 0;
        let loginCalls = 0;
        let logoutCalls = 0;
        const autoRelogin = yield* makeFeature(
          apiWith({
            auth: {
              connectTo: () =>
                Effect.sync(() => {
                  connectCalls += 1;
                  return {
                    message: "Server is full",
                    retryable: true,
                    status: "full" as const,
                  };
                }),
              login: () =>
                Effect.sync(() => {
                  loginCalls += 1;
                  return true;
                }),
              logout: () =>
                Effect.sync(() => {
                  logoutCalls += 1;
                }),
            },
          }),
        );
        const resultFiber = yield* Effect.result(
          autoRelogin.runLogin({
            password: "pw",
            server: "Artix",
            username: "Hero",
          }),
        ).pipe(Effect.forkScoped);

        yield* advance("5 seconds");
        yield* advance("10 seconds");
        yield* advance("20 seconds");
        const result = yield* Fiber.join(resultFiber);

        expect(Result.isFailure(result)).toBe(true);
        expect(loginCalls).toBe(4);
        expect(connectCalls).toBe(4);
        expect(logoutCalls).toBe(4);
      }),
    ).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect("does not retry a server-side account restriction", () =>
    Effect.scoped(
      Effect.gen(function* () {
        let connectCalls = 0;
        const autoRelogin = yield* makeFeature(
          apiWith({
            auth: {
              connectTo: () =>
                Effect.sync(() => {
                  connectCalls += 1;
                  return {
                    message:
                      "account is not authorized for member-only servers",
                    retryable: false,
                    status: "blocked" as const,
                  };
                }),
            },
          }),
        );
        const result = yield* Effect.result(
          autoRelogin.runLogin({
            password: "pw",
            server: "Upgrade",
            username: "Hero",
          }),
        );

        expect(Result.isFailure(result)).toBe(true);
        if (Result.isFailure(result)) {
          expect(result.failure.detail).toBe(
            "Account is not authorized for member-only servers.",
          );
        }
        expect(connectCalls).toBe(1);
      }),
    ),
  );

  it.effect(
    "manual readiness cancels a delayed relogin without replacing its snapshot",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const events = makeConnectionEvents();
          const ready = yield* Ref.make(true);
          const username = yield* Ref.make("Hero");
          let loginCalls = 0;
          const autoRelogin = yield* makeFeature(
            apiWith({
              auth: {
                getUsername: () => Ref.get(username),
                login: () =>
                  Effect.sync(() => {
                    loginCalls += 1;
                    return true;
                  }),
              },
              events: { on: events.on },
              player: { isReady: () => Ref.get(ready) },
            }),
          );
          yield* autoRelogin.setServer("Artix");
          yield* autoRelogin.enable();

          yield* Ref.set(ready, false);
          yield* events.emit("OnConnectionLost");
          yield* Ref.set(username, "Other");
          yield* Ref.set(ready, true);
          yield* events.emit("OnConnection");
          yield* advance("10 seconds");

          expect(loginCalls).toBe(0);
          expect(yield* autoRelogin.getState()).toMatchObject({
            attempting: false,
            server: "Artix",
            username: "Hero",
            waitingDelay: false,
          });
        }),
      ).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect(
    "clears a delayed recovery when the delay itself observes readiness",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const events = makeConnectionEvents();
          const ready = yield* Ref.make(true);
          let loginCalls = 0;
          const autoRelogin = yield* makeFeature(
            apiWith({
              auth: {
                login: () =>
                  Effect.sync(() => {
                    loginCalls += 1;
                    return true;
                  }),
              },
              events: { on: events.on },
              player: { isReady: () => Ref.get(ready) },
            }),
          );
          yield* autoRelogin.setDelay(5_000);
          yield* autoRelogin.enable();

          yield* Ref.set(ready, false);
          yield* events.emit("OnConnectionLost");
          yield* Ref.set(ready, true);
          yield* advance("5 seconds");

          expect(loginCalls).toBe(0);
          expect(yield* autoRelogin.getState()).toMatchObject({
            attempting: false,
            waitingDelay: false,
          });
        }),
      ).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect(
    "accepts manual readiness while an explicit login is waiting on a kick",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const ready = yield* Ref.make(false);
          let loginCalls = 0;
          const autoRelogin = yield* makeFeature(
            apiWith({
              auth: {
                isTemporarilyKicked: () => Effect.succeed(true),
                login: () =>
                  Effect.sleep("60 seconds").pipe(
                    Effect.andThen(
                      Effect.sync(() => {
                        loginCalls += 1;
                        return true;
                      }),
                    ),
                  ),
              },
              player: { isReady: () => Ref.get(ready) },
            }),
          );
          const loginFiber = yield* autoRelogin
            .runLogin({
              password: "pw",
              server: "Artix",
              username: "Hero",
            })
            .pipe(Effect.forkScoped);

          yield* Effect.yieldNow;
          yield* Ref.set(ready, true);
          yield* advance("500 millis");

          expect(loginFiber.pollUnsafe()).toBeDefined();
          expect(yield* Fiber.join(loginFiber)).toEqual({ status: "ready" });
          expect(loginCalls).toBe(0);
        }),
      ).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect("keeps a delayed recovery active when its server changes", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const events = makeConnectionEvents();
        const ready = yield* Ref.make(true);
        const trace: string[] = [];
        const autoRelogin = yield* makeFeature(
          apiWith({
            auth: {
              connectTo: (server) =>
                Ref.set(ready, true).pipe(
                  Effect.tap(() =>
                    Effect.sync(() => {
                      trace.push(`connect:${server}`);
                    }),
                  ),
                  Effect.as({
                    message: "server selected",
                    retryable: false,
                    serverName: server,
                    status: "connected" as const,
                  }),
                ),
              login: () =>
                Effect.sync(() => {
                  trace.push("login");
                  return true;
                }),
            },
            events: { on: events.on },
            player: { isReady: () => Ref.get(ready) },
          }),
        );
        yield* autoRelogin.setDelay(10_000);
        yield* autoRelogin.setServer("Artix");
        yield* autoRelogin.enable();

        yield* Ref.set(ready, false);
        yield* events.emit("OnConnectionLost");
        yield* advance("2 seconds");
        expect(yield* autoRelogin.setServer("Yulgar")).toMatchObject({
          server: "Yulgar",
          waitingDelay: true,
        });

        yield* advance("7 seconds");
        expect(trace).toEqual([]);
        yield* advance("1 second");
        expect(trace).toEqual(["login", "connect:Yulgar"]);
      }),
    ).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect(
    "retries connected-but-unready sessions and logs out between attempts",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          let logoutCalls = 0;
          const autoRelogin = yield* makeFeature(
            apiWith({
              auth: {
                connectTo: () =>
                  Effect.succeed({
                    message: "server selected",
                    retryable: false,
                    status: "connected" as const,
                  }),
                logout: () =>
                  Effect.sync(() => {
                    logoutCalls += 1;
                  }),
              },
            }),
          );
          const resultFiber = yield* Effect.result(
            autoRelogin.runLogin({
              password: "pw",
              server: "Artix",
              username: "Hero",
            }),
          ).pipe(Effect.forkScoped);

          yield* advance("10 seconds");
          yield* advance("5 seconds");
          yield* advance("10 seconds");
          yield* advance("10 seconds");
          yield* advance("10 seconds");
          yield* advance("20 seconds");
          yield* advance("10 seconds");
          expect(Result.isFailure(yield* Fiber.join(resultFiber))).toBe(true);
          expect(logoutCalls).toBe(4);
        }),
      ).pipe(Effect.provide(TestClock.layer())),
  );
});
