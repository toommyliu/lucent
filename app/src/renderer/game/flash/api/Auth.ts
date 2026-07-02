import { Context, Effect, Layer, SynchronizedRef } from "effect";

import type {
  AuthConnectOutcome,
  ConnectToSelectionResult,
  ServerRecord,
} from "../Types";
import { SwfBridge } from "../SwfBridge";
import {
  asArray,
  asBoolean,
  asRecord,
  asString,
  normalizeServerRecord,
} from "../payload";
import { FlashProtocol } from "../protocol/FlashProtocol";
import { WaitApi } from "./Wait";

export interface AuthApiShape {
  readonly connectTo: (server: string) => Effect.Effect<AuthConnectOutcome>;
  readonly getPassword: () => Effect.Effect<string>;
  readonly getServers: () => Effect.Effect<readonly ServerRecord[]>;
  readonly getUsername: () => Effect.Effect<string>;
  readonly isLoggedIn: () => Effect.Effect<boolean>;
  readonly isServerSelectReady: () => Effect.Effect<boolean>;
  readonly isTemporarilyKicked: () => Effect.Effect<boolean>;
  readonly login: (
    username: string,
    password: string,
  ) => Effect.Effect<boolean>;
  readonly logout: () => Effect.Effect<void>;
}

export class AuthApi extends Context.Service<AuthApi, AuthApiShape>()(
  "lucent/game/flash/api/Auth",
) {}

interface AuthRuntimeState {
  readonly servers: Map<string, ServerRecord>;
  loggedIn: boolean;
  password: string;
  username: string;
}

interface FlashSessionSnapshot {
  readonly authenticated: boolean;
  readonly connected: boolean;
  readonly password: string;
  readonly servers: readonly ServerRecord[];
  readonly username: string;
}

const initialState = (): AuthRuntimeState => ({
  loggedIn: false,
  password: "",
  servers: new Map(),
  username: "",
});

const serverNameField = (serverName: string | undefined) =>
  serverName === undefined || serverName === "" ? {} : { serverName };

const connectedOutcome = (
  serverName: string | undefined,
): AuthConnectOutcome => ({
  message: "connected",
  retryable: false,
  status: "connected",
  ...serverNameField(serverName),
});

const connectFailure = (
  status: AuthConnectOutcome["status"],
  message: string,
  retryable: boolean,
  serverName: string | undefined,
): AuthConnectOutcome => ({
  message,
  retryable,
  status,
  ...serverNameField(serverName),
});

const selectionOutcome = (
  selection: ConnectToSelectionResult | null,
  requestedServer: string,
): AuthConnectOutcome => {
  const serverName = selection?.serverName ?? requestedServer;

  if (selection === null) {
    return connectFailure(
      "not-ready",
      "server selection is not ready",
      true,
      serverName,
    );
  }

  if (selection.ok) {
    return connectedOutcome(serverName);
  }

  if (selection.status === "blocked" && selection.reason === "full") {
    return connectFailure("full", selection.message, true, serverName);
  }

  return connectFailure(
    selection.status,
    selection.message,
    selection.status === "not-ready",
    serverName,
  );
};

const timeoutOutcome = (serverName: string | undefined): AuthConnectOutcome =>
  connectFailure("timeout", "timed out connecting to server", true, serverName);

const requiredServerOutcome = (): AuthConnectOutcome => ({
  message: "server is required",
  retryable: false,
  status: "not-found",
});

const temporaryKickOutcome = (
  serverName: string | undefined,
): AuthConnectOutcome =>
  connectFailure("timeout", "temporary kick did not clear", true, serverName);

const parseFlashJsonObject = (
  value: unknown,
): Record<string, unknown> | null => {
  if (typeof value !== "string") {
    return asRecord(value);
  }

  try {
    return asRecord(JSON.parse(value) as unknown);
  } catch {
    return null;
  }
};

const normalizeServers = (value: unknown): readonly ServerRecord[] =>
  Array.isArray(value)
    ? value
        .map(normalizeServerRecord)
        .filter((server): server is ServerRecord => server !== null)
    : [];

export const layer = Layer.effect(
  AuthApi,
  Effect.gen(function* () {
    const bridge = yield* SwfBridge;
    const protocol = yield* FlashProtocol;
    const wait = yield* WaitApi;
    const ref = yield* SynchronizedRef.make(initialState());

    const clear = SynchronizedRef.update(ref, (state) => {
      state.loggedIn = false;
      state.password = "";
      state.servers.clear();
      state.username = "";
      return state;
    });

    const setCredentials = (username: string, password: string) =>
      SynchronizedRef.update(ref, (state) => {
        state.username = username;
        state.password = password;
        return state;
      });

    const setLoggedIn = (loggedIn: boolean) =>
      SynchronizedRef.update(ref, (state) => {
        state.loggedIn = loggedIn;
        return state;
      });

    const setServers = (servers: readonly ServerRecord[]) =>
      SynchronizedRef.update(ref, (state) => {
        state.servers.clear();
        for (const server of servers) {
          state.servers.set(server.name.toLowerCase(), server);
        }
        return state;
      });

    const readLoginServers = bridge
      .call("flash.getGameObjectS", ["objLogin"])
      .pipe(
        Effect.map((rawLogin) => {
          const login = parseFlashJsonObject(rawLogin);
          return normalizeServers(asArray(login?.["servers"]));
        }),
        Effect.catchCause(() => Effect.succeed([])),
      );

    const readBridgeServers = Effect.gen(function* () {
      const servers = yield* bridge.call("auth.getServers").pipe(
        Effect.map(normalizeServers),
        Effect.catchCause(() => Effect.succeed([])),
      );
      return servers.length > 0 ? servers : yield* readLoginServers;
    });

    const readFlashSession: Effect.Effect<FlashSessionSnapshot> = Effect.gen(
      function* () {
        const connected = yield* bridge
          .call("auth.isLoggedIn")
          .pipe(Effect.catchCause(() => Effect.succeed(false)));
        const [rawLogin, rawCredentials] = yield* Effect.all([
          bridge.call("flash.getGameObjectS", ["objLogin"]),
          bridge.call("flash.getGameObjectS", ["loginInfo"]),
        ]);
        const login = parseFlashJsonObject(rawLogin);
        const credentials = parseFlashJsonObject(rawCredentials);
        const username = (
          asString(login?.["unm"]) ??
          asString(credentials?.["strUsername"]) ??
          ""
        ).trim();
        const password = asString(credentials?.["strPassword"]) ?? "";
        const servers = asArray(login?.["servers"])
          .map(normalizeServerRecord)
          .filter((server): server is ServerRecord => server !== null);
        const authenticated =
          connected ||
          asBoolean(login?.["bSuccess"]) === true ||
          servers.length > 0;

        return {
          authenticated,
          connected,
          password,
          servers,
          username,
        };
      },
    );

    const refreshCachedSession = Effect.gen(function* () {
      const session = yield* readFlashSession;
      if (
        !session.authenticated ||
        session.username === "" ||
        session.password === ""
      ) {
        return false;
      }

      yield* SynchronizedRef.update(ref, (state) => {
        state.loggedIn = session.connected;
        state.username = session.username;
        state.password = session.password;
        if (session.servers.length > 0) {
          state.servers.clear();
          for (const server of session.servers) {
            state.servers.set(server.name.toLowerCase(), server);
          }
        }
        return state;
      });
      return true;
    }).pipe(Effect.catchCause(() => Effect.succeed(false)));

    const getCachedCredential = (field: "password" | "username") =>
      Effect.gen(function* () {
        const cached = yield* SynchronizedRef.get(ref).pipe(
          Effect.map((state) => state[field]),
        );
        if (cached !== "") {
          return cached;
        }

        yield* refreshCachedSession;
        return yield* SynchronizedRef.get(ref).pipe(
          Effect.map((state) => state[field]),
        );
      });

    const disposeConnection = yield* protocol.onEvent(
      { type: "connection" },
      (event) => {
        const status = event.type === "connection" ? event.payload.status : "";
        if (status === "OnConnection") {
          return setLoggedIn(true).pipe(Effect.andThen(refreshCachedSession));
        }
        if (status === "OnConnectionLost" || status === "OnConnectionFailed") {
          return clear;
        }
        return Effect.void;
      },
    );
    yield* Effect.addFinalizer(() => Effect.sync(disposeConnection));

    const getServers = readBridgeServers.pipe(
      Effect.flatMap((servers) =>
        servers.length > 0
          ? setServers(servers).pipe(Effect.as(servers))
          : SynchronizedRef.get(ref).pipe(
              Effect.map((state) => Array.from(state.servers.values())),
            ),
      ),
    );

    const isLoggedIn = SynchronizedRef.get(ref).pipe(
      Effect.map((state) => state.loggedIn),
    );
    const isServerSelectReady = bridge
      .call("flash.isNull", ["mcLogin.sl.iList"])
      .pipe(
        Effect.map((isNull) => !isNull),
        Effect.catchCause(() => Effect.succeed(false)),
      );
    const isTemporarilyKicked = bridge.call("auth.isTemporarilyKicked");
    const waitForTemporaryKickClear = wait.until(
      isTemporarilyKicked.pipe(
        Effect.map((temporarilyKicked) => !temporarilyKicked),
      ),
      {
        interval: "1 second",
        timeout: "1 minute",
      },
    );

    const login: AuthApiShape["login"] = (username, password) =>
      Effect.gen(function* () {
        const user = username.trim();
        if (user === "" || password === "") {
          return false;
        }

        if (yield* isLoggedIn) {
          yield* bridge.call("auth.logout");
          yield* clear;
        }

        if (!(yield* waitForTemporaryKickClear)) {
          return false;
        }

        const ready = yield* wait.until(
          bridge
            .call("flash.isNull", ["mcLogin.btnLogin"])
            .pipe(Effect.map((isNull) => !isNull)),
          { timeout: "15 seconds" },
        );
        if (!ready) {
          return false;
        }

        yield* bridge.call("auth.login", [user, password]);
        yield* setCredentials(user, password);
        return yield* wait.until(
          refreshCachedSession.pipe(
            Effect.flatMap((captured) =>
              captured ? isServerSelectReady : Effect.succeed(false),
            ),
          ),
          { interval: "100 millis", timeout: "15 seconds" },
        );
      });

    const connectTo: AuthApiShape["connectTo"] = (server) =>
      Effect.gen(function* () {
        const requestedServer = server.trim();
        if (requestedServer === "") {
          return requiredServerOutcome();
        }

        if (!(yield* waitForTemporaryKickClear)) {
          return temporaryKickOutcome(requestedServer);
        }

        const selectServer = bridge
          .call("auth.connectTo", [requestedServer])
          .pipe(
            Effect.map((selection) =>
              selectionOutcome(selection, requestedServer),
            ),
          );
        let initial = yield* selectServer;
        if (initial.status === "not-ready") {
          const ready = yield* wait.until(isServerSelectReady, {
            interval: "100 millis",
            timeout: "5 seconds",
          });
          if (ready) {
            initial = yield* selectServer;
          }
        }

        if (initial.status !== "connected") {
          return initial;
        }

        const connection = yield* protocol.onceEvent(
          { type: "connection" },
          { timeout: "10 seconds" },
        );
        const status =
          connection?.type === "connection" ? connection.payload.status : "";
        if (status === "OnConnection") {
          yield* setLoggedIn(true);
          return initial;
        }

        return timeoutOutcome(initial.serverName ?? requestedServer);
      });

    const logout = Effect.gen(function* () {
      yield* bridge.call("auth.logout");
      yield* clear;
    });

    return AuthApi.of({
      connectTo,
      getPassword: () => getCachedCredential("password"),
      getServers: () => getServers,
      getUsername: () => getCachedCredential("username"),
      isLoggedIn: () => isLoggedIn,
      isServerSelectReady: () => isServerSelectReady,
      isTemporarilyKicked: () => isTemporarilyKicked,
      login,
      logout: () => logout,
    });
  }),
);
