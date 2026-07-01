import { Context, Effect, Layer, SynchronizedRef } from "effect";

import type {
  AuthConnectOutcome,
  ConnectToSelectionResult,
  ServerRecord,
} from "../Types";
import { SwfBridge } from "../SwfBridge";
import { normalizeServerRecord } from "../payload";
import { FlashProtocol } from "../protocol/FlashProtocol";
import { WaitApi } from "./Wait";

export interface AuthApiShape {
  readonly connectTo: (server: string) => Effect.Effect<AuthConnectOutcome>;
  readonly getPassword: Effect.Effect<string>;
  readonly getServers: Effect.Effect<readonly ServerRecord[]>;
  readonly getUsername: Effect.Effect<string>;
  readonly isLoggedIn: Effect.Effect<boolean>;
  readonly isTemporarilyKicked: Effect.Effect<boolean>;
  readonly login: (
    username: string,
    password: string,
  ) => Effect.Effect<boolean>;
  readonly logout: Effect.Effect<void>;
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

    const disposeConnection = yield* protocol.onEvent(
      { type: "connection" },
      (event) => {
        const status = event.type === "connection" ? event.payload.status : "";
        if (status === "OnConnection") {
          return setLoggedIn(true);
        }
        if (status === "OnConnectionLost" || status === "OnConnectionFailed") {
          return clear;
        }
        return Effect.void;
      },
    );
    yield* Effect.addFinalizer(() => Effect.sync(disposeConnection));

    const getServers = bridge.call("auth.getServers").pipe(
      Effect.map((rawServers) =>
        Array.isArray(rawServers)
          ? rawServers
              .map(normalizeServerRecord)
              .filter((server): server is ServerRecord => server !== null)
          : [],
      ),
      Effect.tap(setServers),
    );

    const isLoggedIn = SynchronizedRef.get(ref).pipe(
      Effect.map((state) => state.loggedIn),
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
        const connection = yield* protocol.onceEvent(
          { type: "connection" },
          { timeout: "10 seconds" },
        );
        const status =
          connection?.type === "connection" ? connection.payload.status : "";
        const loggedIn = status === "OnConnection";
        yield* setLoggedIn(loggedIn);
        return loggedIn;
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

        const selection = yield* bridge.call("auth.connectTo", [
          requestedServer,
        ]);
        const initial = selectionOutcome(selection, requestedServer);
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
      getPassword: SynchronizedRef.get(ref).pipe(
        Effect.map((state) => state.password),
      ),
      getServers,
      getUsername: SynchronizedRef.get(ref).pipe(
        Effect.map((state) => state.username),
      ),
      isLoggedIn,
      isTemporarilyKicked,
      login,
      logout,
    });
  }),
);
