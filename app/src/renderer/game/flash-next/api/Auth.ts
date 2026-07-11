import { Effect, Option, Schema } from "effect";

import type { BridgeService } from "../bridge/Bridge";
import type { ConnectOutcome } from "../contract/Api";
import { ServerPayloads, toServer } from "../contract/payload/Auth";
import type { Store } from "../state/Store";
import type { Wait } from "./Wait";

const Credentials = Schema.Struct({
  password: Schema.String,
  username: Schema.String,
});
const ConnectResult = Schema.Union([
  Schema.Struct({
    message: Schema.String,
    ok: Schema.Literal(true),
    serverName: Schema.optionalKey(Schema.String),
    status: Schema.Literal("selected"),
  }),
  Schema.Struct({
    message: Schema.String,
    ok: Schema.Literal(false),
    reason: Schema.optionalKey(Schema.String),
    serverName: Schema.optionalKey(Schema.String),
    status: Schema.Literals(["blocked", "not-found", "not-ready"]),
  }),
]);
const decodeCredentials = Schema.decodeUnknownOption(Credentials);

export const makeAuth = (bridge: BridgeService, store: Store, wait: Wait) => {
  const isLoggedIn = bridge
    .invoke("auth.isLoggedIn", undefined, Schema.Boolean)
    .pipe(
      Effect.flatMap(
        Option.match({
          onNone: () =>
            store.auth.get.pipe(Effect.map((state) => state.loggedIn)),
          onSome: (loggedIn) =>
            store.auth.setLoggedIn(loggedIn).pipe(Effect.as(loggedIn)),
        }),
      ),
    );
  const isTemporarilyKicked = bridge
    .invoke("auth.isTemporarilyKicked", undefined, Schema.Boolean)
    .pipe(Effect.map(Option.getOrElse(() => false)));

  return {
    connectTo: (server: string): Effect.Effect<ConnectOutcome> => {
      const requested = server.trim();
      if (requested === "") {
        return Effect.succeed({
          message: "server is required",
          retryable: false,
          status: "not-found",
        });
      }
      return bridge.invoke("auth.connectTo", [requested], ConnectResult).pipe(
        Effect.map(
          Option.match({
            onNone: (): ConnectOutcome => ({
              message: "server selection is not ready",
              retryable: true,
              serverName: requested,
              status: "not-ready",
            }),
            onSome: (result): ConnectOutcome =>
              result.ok
                ? {
                    message: result.message,
                    retryable: false,
                    serverName: result.serverName ?? requested,
                    status: "connected",
                  }
                : {
                    message: result.message,
                    retryable:
                      result.status === "not-ready" || result.reason === "full",
                    serverName: result.serverName ?? requested,
                    status: result.reason === "full" ? "full" : result.status,
                  },
          }),
        ),
      );
    },
    getPassword: () =>
      store.auth.get.pipe(Effect.map((state) => state.password)),
    getServers: () =>
      bridge.invoke("auth.getServers", undefined, ServerPayloads).pipe(
        Effect.flatMap(
          Option.match({
            onNone: () =>
              store.auth.get.pipe(
                Effect.map((state) => Array.from(state.servers.values())),
              ),
            onSome: (payloads) => {
              const servers = payloads.map(toServer);
              return store.auth.setServers(servers).pipe(Effect.as(servers));
            },
          }),
        ),
      ),
    getUsername: () =>
      store.auth.get.pipe(Effect.map((state) => state.username)),
    isLoggedIn: () => isLoggedIn,
    isServerSelectReady: () =>
      bridge
        .invoke("flash.isNull", ["mcLogin.sl.iList"], Schema.Boolean)
        .pipe(Effect.map((value) => !Option.getOrElse(value, () => true))),
    isTemporarilyKicked: () => isTemporarilyKicked,
    login: (username: string, password: string) => {
      const credentials = decodeCredentials({
        password,
        username: username.trim(),
      });
      if (
        Option.isNone(credentials) ||
        credentials.value.username === "" ||
        credentials.value.password === ""
      ) {
        return Effect.succeed(false);
      }
      return wait
        .until(isTemporarilyKicked.pipe(Effect.map((kicked) => !kicked)), {
          interval: "1 second",
          timeout: "1 minute",
        })
        .pipe(
          Effect.flatMap((ready) =>
            ready
              ? bridge.invoke(
                  "auth.login",
                  [credentials.value.username, credentials.value.password],
                  Schema.Void,
                )
              : Effect.succeed(Option.none()),
          ),
          Effect.flatMap(
            Option.match({
              onNone: () => Effect.succeed(false),
              onSome: () =>
                store.auth
                  .setCredentials(
                    credentials.value.username,
                    credentials.value.password,
                  )
                  .pipe(Effect.as(true)),
            }),
          ),
        );
    },
    logout: () =>
      bridge
        .invoke("auth.logout", undefined, Schema.Void)
        .pipe(Effect.andThen(store.auth.clear), Effect.asVoid),
  };
};

export type Auth = ReturnType<typeof makeAuth>;
