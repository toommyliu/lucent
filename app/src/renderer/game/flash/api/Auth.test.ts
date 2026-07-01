import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";

import { SwfBridge, type SwfBridgeShape } from "../SwfBridge";
import {
  FlashProtocol,
  type FlashProtocolShape,
} from "../protocol/FlashProtocol";
import { WaitApi, type WaitApiShape } from "./Wait";
import { AuthApi, layer as AuthLayer } from "./Auth";

const rawServer = {
  bOnline: 1,
  bUpg: 0,
  iChat: 1,
  iCount: 42,
  iMax: 1_000,
  sLang: "en",
  sName: "Artix",
};

const parseJson = (value: unknown): unknown => {
  if (typeof value !== "string") {
    return value;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
};

const makeHarness = () => {
  const calls: Array<{
    readonly args: readonly unknown[];
    readonly method: string;
  }> = [];
  let currentLabel = "Login";
  let loginCalls = 0;
  let serverListSourceReady = true;
  let serialServers: readonly unknown[] = [];
  let objLogin = {
    bSuccess: 1,
    servers: [rawServer],
    unm: "Hero",
  };
  const loginInfo = {
    strPassword: "pw",
    strUsername: "Hero",
  };

  const bridge = SwfBridge.of({
    call: ((method, args) =>
      Effect.sync(() => {
        calls.push({ args: args ?? [], method });

        switch (method) {
          case "auth.getServers":
            return serialServers;
          case "auth.isLoggedIn":
            return false;
          case "auth.isTemporarilyKicked":
            return false;
          case "auth.login":
            loginCalls += 1;
            currentLabel = "Servers";
            return undefined;
          case "auth.logout":
            currentLabel = "Login";
            return undefined;
          case "flash.getGameObject":
            return JSON.stringify(
              args?.[0] === "mcLogin.currentLabel" ? currentLabel : null,
            );
          case "flash.getGameObjectS":
            if (args?.[0] === "objLogin") {
              return JSON.stringify(objLogin);
            }
            if (args?.[0] === "loginInfo") {
              return JSON.stringify(loginInfo);
            }
            return "null";
          case "flash.isNull":
            if (args?.[0] === "mcLogin.btnLogin") {
              return false;
            }
            if (args?.[0] === "mcLogin.sl.iList") {
              return !serverListSourceReady;
            }
            return true;
          default:
            return undefined;
        }
      })) as SwfBridgeShape["call"],
    callGameFunction: () => Effect.succeed(null),
    readJson: (method, args) =>
      bridge
        .call(method, args as Parameters<Window["swf"][typeof method]>)
        .pipe(Effect.map(parseJson)),
  });
  const protocol = FlashProtocol.of({
    emitEvent: () => Effect.void,
    onEvent: () => Effect.succeed(() => {}),
    onPacket: () => Effect.succeed(() => {}),
    onceEvent: () => Effect.succeed(null),
    oncePacket: () => Effect.succeed(null),
    sendClient: () => Effect.void,
    sendServer: () => Effect.void,
  } satisfies FlashProtocolShape);
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
    calls,
    layer: AuthLayer.pipe(
      Layer.provideMerge(
        Layer.mergeAll(
          Layer.succeed(SwfBridge, bridge),
          Layer.succeed(FlashProtocol, protocol),
          Layer.succeed(WaitApi, wait),
        ),
      ),
    ),
    loginCalls: () => loginCalls,
    setObjLogin: (next: typeof objLogin) => {
      objLogin = next;
    },
    setSerialServers: (servers: readonly unknown[]) => {
      serialServers = servers;
    },
    setServerListSourceReady: (ready: boolean) => {
      serverListSourceReady = ready;
    },
  };
};

describe("AuthApi", () => {
  it.effect("uses objLogin servers after server selection is clickable", () =>
    Effect.gen(function* () {
      const harness = makeHarness();
      yield* Effect.scoped(
        Effect.gen(function* () {
          const auth = yield* AuthApi;
          const loggedIn = yield* auth.login("Hero", "pw");
          const servers = yield* auth.getServers;

          expect(loggedIn).toBe(true);
          expect(harness.loginCalls()).toBe(1);
          expect(servers.map((server) => server.name)).toEqual(["Artix"]);
          expect(yield* auth.getUsername).toBe("Hero");
          expect(yield* auth.getPassword).toBe("pw");
        }).pipe(Effect.provide(harness.layer)),
      );
    }),
  );

  it.effect(
    "does not treat objLogin servers alone as clickable server selection",
    () =>
      Effect.gen(function* () {
        const harness = makeHarness();
        harness.setServerListSourceReady(false);

        yield* Effect.scoped(
          Effect.gen(function* () {
            const auth = yield* AuthApi;
            const loggedIn = yield* auth.login("Hero", "pw");
            const servers = yield* auth.getServers;

            expect(loggedIn).toBe(false);
            expect(harness.loginCalls()).toBe(1);
            expect(servers.map((server) => server.name)).toEqual(["Artix"]);
          }).pipe(Effect.provide(harness.layer)),
        );
      }),
  );

  it.effect(
    "does not accept the server-select frame without a captured session",
    () =>
      Effect.gen(function* () {
        const harness = makeHarness();
        harness.setObjLogin({
          bSuccess: 0,
          servers: [],
          unm: "",
        });

        yield* Effect.scoped(
          Effect.gen(function* () {
            const auth = yield* AuthApi;
            const loggedIn = yield* auth.login("Hero", "pw");

            expect(loggedIn).toBe(false);
            expect(harness.loginCalls()).toBe(1);
          }).pipe(Effect.provide(harness.layer)),
        );
      }),
  );
});
