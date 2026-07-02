import { Cause, Clock, Context, Effect, Layer, SynchronizedRef } from "effect";

import type { AuthConnectOutcome, ServerRecord } from "../Types";
import { AuthApi } from "../api/Auth";
import { EventsApi } from "../api/Events";
import { PlayerApi } from "../api/Player";
import { WaitApi } from "../api/Wait";
import { equalsIgnoreCase } from "../payload";
import {
  makeStateListeners,
  type StateDisposer,
  type StateSubscriptionOptions,
} from "../StateListeners";

export interface AutoReloginState {
  readonly attemptsRemaining?: number;
  readonly attempting: boolean;
  readonly captured: boolean;
  readonly delayMs: number;
  readonly enabled: boolean;
  readonly lastError?: string;
  readonly server?: string;
  readonly username?: string;
  readonly waitingDelay: boolean;
}

export interface AutoReloginShape {
  readonly disable: () => Effect.Effect<AutoReloginState>;
  readonly enable: () => Effect.Effect<AutoReloginState>;
  readonly getDelay: () => Effect.Effect<number>;
  readonly getServer: () => Effect.Effect<string | undefined>;
  readonly getState: () => Effect.Effect<AutoReloginState>;
  readonly isEnabled: () => Effect.Effect<boolean>;
  readonly onState: (
    listener: (state: AutoReloginState) => void,
    options?: StateSubscriptionOptions,
  ) => Effect.Effect<StateDisposer>;
  readonly setDelay: (delayMs: number) => Effect.Effect<AutoReloginState>;
  readonly setEnabled: (enabled: boolean) => Effect.Effect<AutoReloginState>;
  readonly setServer: (serverName: string) => Effect.Effect<AutoReloginState>;
}

export class AutoRelogin extends Context.Service<
  AutoRelogin,
  AutoReloginShape
>()("lucent/game/flash/features/AutoRelogin") {}

type ReloginPhase =
  | { readonly tag: "idle" }
  | { readonly since: number; readonly tag: "waitingDelay" }
  | {
      readonly attemptId: number;
      readonly retriesRemaining: number;
      readonly step: "connect" | "login" | "ready";
      readonly tag: "attempting";
    }
  | { readonly tag: "stopped" };

interface CapturedCredentials {
  readonly password: string;
  readonly username: string;
}

interface RuntimeState {
  attemptId: number;
  attemptsRemaining: number | undefined;
  credentials: CapturedCredentials | null;
  delayMs: number;
  enabled: boolean;
  lastError: string | undefined;
  loggedOutSince: number | undefined;
  phase: ReloginPhase;
  server: string | undefined;
}

type AttemptFailure = {
  readonly message: string;
  readonly retryable: boolean;
};

type AttemptResult =
  | { readonly status: "failure"; readonly failure: AttemptFailure }
  | { readonly status: "stale" }
  | { readonly status: "success" };

interface ReservedAttempt {
  readonly attemptId: number;
  readonly credentials: CapturedCredentials;
  readonly server: string;
}

interface ReserveAttemptResult {
  readonly attempt: ReservedAttempt | null;
  readonly publicState: AutoReloginState;
}

const DEFAULT_DELAY_MS = 3_000;
const MAX_DELAY_MS = 300_000;
const MIN_FAILURE_COOLDOWN_MS = 5_000;
const MAX_FAILURE_COOLDOWN_MS = 60_000;
const MAX_RELOGIN_RETRIES = 3;
const PLAYER_READY_TIMEOUT = "10 seconds";

const initialState = (): RuntimeState => ({
  attemptId: 0,
  attemptsRemaining: undefined,
  credentials: null,
  delayMs: DEFAULT_DELAY_MS,
  enabled: false,
  lastError: undefined,
  loggedOutSince: undefined,
  phase: { tag: "idle" },
  server: undefined,
});

const normalizeDelayMs = (delayMs: number): number =>
  Number.isFinite(delayMs)
    ? Math.min(MAX_DELAY_MS, Math.max(0, Math.trunc(delayMs)))
    : DEFAULT_DELAY_MS;

const isAttempting = (phase: ReloginPhase): boolean =>
  phase.tag === "attempting";

const canRelogin = (state: RuntimeState): boolean =>
  state.enabled && state.credentials !== null && state.server !== undefined;

const toPublicState = (state: RuntimeState): AutoReloginState => ({
  attempting: isAttempting(state.phase),
  captured: state.credentials !== null,
  delayMs: state.delayMs,
  enabled: state.enabled,
  waitingDelay: state.phase.tag === "waitingDelay",
  ...(state.attemptsRemaining === undefined
    ? {}
    : { attemptsRemaining: state.attemptsRemaining }),
  ...(state.credentials === null
    ? {}
    : { username: state.credentials.username }),
  ...(state.server === undefined ? {} : { server: state.server }),
  ...(state.lastError === undefined ? {} : { lastError: state.lastError }),
});

const redacted = (message: string, secret: string | undefined): string =>
  secret === undefined || secret === ""
    ? message
    : message.replaceAll(secret, "[redacted]");

const capitalizeFirstLetter = (message: string): string =>
  message === "" ? message : message.charAt(0).toUpperCase() + message.slice(1);

const connectFailureMessage = (
  outcome: Exclude<AuthConnectOutcome, { readonly status: "connected" }>,
): string => capitalizeFirstLetter(`${outcome.message} (${outcome.status})`);

const findServer = (
  servers: readonly ServerRecord[],
  serverName: string,
): ServerRecord | undefined =>
  servers.find((server) => equalsIgnoreCase(server.name, serverName));

const nextCooldown = (retryIndex: number): number =>
  Math.min(
    MAX_FAILURE_COOLDOWN_MS,
    MIN_FAILURE_COOLDOWN_MS * 2 ** Math.max(0, retryIndex),
  );

const fail = (message: string, retryable: boolean): AttemptResult => ({
  failure: { message, retryable },
  status: "failure",
});

const setIdleOrWaiting = (state: RuntimeState) => {
  if (canRelogin(state) && state.loggedOutSince !== undefined) {
    state.phase = { since: state.loggedOutSince, tag: "waitingDelay" };
    return;
  }

  state.phase = { tag: "idle" };
};

export const layer = Layer.effect(
  AutoRelogin,
  Effect.gen(function* () {
    const auth = yield* AuthApi;
    const events = yield* EventsApi;
    const player = yield* PlayerApi;
    const wait = yield* WaitApi;
    const ref = yield* SynchronizedRef.make(initialState());
    const listeners = makeStateListeners<AutoReloginState>("autorelogin");

    const snapshot = SynchronizedRef.get(ref).pipe(Effect.map(toPublicState));

    const updateState = (
      update: (state: RuntimeState, now: number) => void,
    ): Effect.Effect<AutoReloginState> =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        const state = yield* SynchronizedRef.modify(ref, (current) => {
          update(current, now);
          return [toPublicState(current), current] as const;
        });
        yield* listeners.emit(state);
        return state;
      });

    const readyNow = player
      .isReady()
      .pipe(Effect.catchCause(() => Effect.succeed(false)));

    const captureCredentials = (options?: {
      readonly reportFailure?: boolean;
    }) =>
      Effect.gen(function* () {
        const username = (yield* auth.getUsername()).trim();
        const password = yield* auth.getPassword();

        if (username === "" || password === "") {
          yield* updateState((state) => {
            state.credentials = null;
            state.attemptsRemaining = undefined;
            if (options?.reportFailure === true) {
              state.lastError = "current session is not capturable";
            }
          });
          return false;
        }

        yield* updateState((state) => {
          state.credentials = { password, username };
          state.lastError = undefined;
          state.attemptsRemaining = undefined;
          if (state.phase.tag === "stopped") {
            setIdleOrWaiting(state);
          }
        });
        return true;
      });

    const markReadySuccess = () =>
      updateState((state) => {
        state.phase = { tag: "idle" };
        state.lastError = undefined;
        state.attemptsRemaining = undefined;
        state.loggedOutSince = undefined;
      });

    const markLoggedOut = (now: number) =>
      updateState((state) => {
        if (!canRelogin(state) || state.phase.tag === "stopped") {
          return;
        }

        state.loggedOutSince ??= now;
        if (state.phase.tag !== "attempting") {
          state.phase = { since: state.loggedOutSince, tag: "waitingDelay" };
        }
      });

    const isCurrentAttempt = (attemptId: number) =>
      SynchronizedRef.get(ref).pipe(
        Effect.map(
          (state) =>
            state.enabled &&
            state.phase.tag === "attempting" &&
            state.phase.attemptId === attemptId,
        ),
      );

    const setAttemptStep = (
      attemptId: number,
      step: "connect" | "login" | "ready",
      retriesRemaining: number,
    ) =>
      updateState((state) => {
        if (
          state.enabled &&
          state.phase.tag === "attempting" &&
          state.phase.attemptId === attemptId
        ) {
          state.phase = {
            attemptId,
            retriesRemaining,
            step,
            tag: "attempting",
          };
          state.attemptsRemaining = retriesRemaining;
        }
      }).pipe(Effect.asVoid);

    const markAttemptSuccess = (attemptId: number) =>
      updateState((state) => {
        if (state.attemptId !== attemptId) {
          return;
        }

        state.phase = { tag: "idle" };
        state.lastError = undefined;
        state.attemptsRemaining = undefined;
        state.loggedOutSince = undefined;
      });

    const markAttemptStopped = (
      attemptId: number,
      message: string,
      secret: string,
      attemptsRemaining: number | undefined,
    ) =>
      updateState((state) => {
        if (state.attemptId !== attemptId) {
          return;
        }

        state.phase = { tag: "stopped" };
        state.lastError = redacted(message, secret);
        state.attemptsRemaining = attemptsRemaining;
      });

    const markRetryFailure = (
      attemptId: number,
      message: string,
      secret: string,
      retriesRemaining: number,
    ) =>
      updateState((state) => {
        if (
          state.phase.tag !== "attempting" ||
          state.phase.attemptId !== attemptId
        ) {
          return;
        }

        state.lastError = redacted(message, secret);
        state.attemptsRemaining = retriesRemaining;
        state.phase = {
          attemptId,
          retriesRemaining,
          step: "login",
          tag: "attempting",
        };
      }).pipe(Effect.asVoid);

    const waitForReadyPlayer = (
      attemptId: number,
      retriesRemaining: number,
    ): Effect.Effect<AttemptResult> =>
      Effect.gen(function* () {
        yield* setAttemptStep(attemptId, "ready", retriesRemaining);
        const ready = yield* wait.until(readyNow, {
          timeout: PLAYER_READY_TIMEOUT,
        });
        if (!(yield* isCurrentAttempt(attemptId))) {
          return { status: "stale" };
        }
        if (ready) {
          return { status: "success" };
        }

        const loggedOut = yield* auth.logout().pipe(
          Effect.as(true),
          Effect.catchCause((cause) =>
            Effect.logWarning({
              cause,
              message: "autorelogin readiness recovery logout failed",
            }).pipe(Effect.as(false)),
          ),
        );
        return loggedOut
          ? fail("player did not become ready", true)
          : fail("logout failed", false);
      });

    const performAttempt = (
      attempt: ReservedAttempt,
      retriesRemaining: number,
    ): Effect.Effect<AttemptResult> =>
      Effect.gen(function* () {
        if (!(yield* isCurrentAttempt(attempt.attemptId))) {
          return { status: "stale" };
        }
        if (yield* readyNow) {
          return { status: "success" };
        }

        yield* setAttemptStep(attempt.attemptId, "login", retriesRemaining);
        const loginReady = yield* auth.login(
          attempt.credentials.username,
          attempt.credentials.password,
        );
        if (!(yield* isCurrentAttempt(attempt.attemptId))) {
          return { status: "stale" };
        }
        if (yield* readyNow) {
          return { status: "success" };
        }
        if (!loginReady) {
          return fail("login did not reach server selection", true);
        }

        yield* setAttemptStep(attempt.attemptId, "connect", retriesRemaining);
        const connect = yield* auth.connectTo(attempt.server);
        if (!(yield* isCurrentAttempt(attempt.attemptId))) {
          return { status: "stale" };
        }
        if (yield* readyNow) {
          return { status: "success" };
        }
        if (connect.status !== "connected") {
          return fail(connectFailureMessage(connect), connect.retryable);
        }

        return yield* waitForReadyPlayer(attempt.attemptId, retriesRemaining);
      });

    const runAttemptWithRetries = (attempt: ReservedAttempt) =>
      Effect.gen(function* () {
        let retriesRemaining = MAX_RELOGIN_RETRIES;
        let failureCount = 0;

        while (true) {
          const result = yield* performAttempt(attempt, retriesRemaining);

          if (result.status === "stale") {
            return;
          }

          if (result.status === "success") {
            yield* markAttemptSuccess(attempt.attemptId);
            return;
          }

          const message = result.failure.message;
          if (!result.failure.retryable) {
            yield* markAttemptStopped(
              attempt.attemptId,
              message,
              attempt.credentials.password,
              undefined,
            );
            return;
          }

          if (retriesRemaining === 0) {
            yield* markAttemptStopped(
              attempt.attemptId,
              message,
              attempt.credentials.password,
              0,
            );
            return;
          }

          retriesRemaining -= 1;
          failureCount += 1;
          yield* markRetryFailure(
            attempt.attemptId,
            message,
            attempt.credentials.password,
            retriesRemaining,
          );
          yield* Effect.sleep(`${nextCooldown(failureCount - 1)} millis`);

          if (!(yield* isCurrentAttempt(attempt.attemptId))) {
            return;
          }
        }
      }).pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.failCause(cause)
            : Effect.logWarning({
                cause,
                message: "autorelogin attempt failed unexpectedly",
              }).pipe(
                Effect.andThen(
                  markAttemptStopped(
                    attempt.attemptId,
                    "autorelogin failed",
                    attempt.credentials.password,
                    undefined,
                  ),
                ),
              ),
        ),
      );

    const reserveAttempt: Effect.Effect<ReservedAttempt | null> = Effect.gen(
      function* () {
        const now = yield* Clock.currentTimeMillis;
        const result = yield* SynchronizedRef.modify(
          ref,
          (state): readonly [ReserveAttemptResult, RuntimeState] => {
            const credentials = state.credentials;
            const server = state.server;
            if (
              !state.enabled ||
              credentials === null ||
              server === undefined ||
              state.loggedOutSince === undefined ||
              state.phase.tag === "attempting" ||
              state.phase.tag === "stopped"
            ) {
              return [
                { attempt: null, publicState: toPublicState(state) },
                state,
              ] as const;
            }

            if (now < state.loggedOutSince + state.delayMs) {
              state.phase = {
                since: state.loggedOutSince,
                tag: "waitingDelay",
              };
              return [
                { attempt: null, publicState: toPublicState(state) },
                state,
              ] as const;
            }

            state.attemptId += 1;
            state.attemptsRemaining = MAX_RELOGIN_RETRIES;
            state.lastError = undefined;
            state.phase = {
              attemptId: state.attemptId,
              retriesRemaining: MAX_RELOGIN_RETRIES,
              step: "login",
              tag: "attempting",
            };
            return [
              {
                attempt: {
                  attemptId: state.attemptId,
                  credentials,
                  server,
                },
                publicState: toPublicState(state),
              },
              state,
            ] as const;
          },
        );

        yield* listeners.emit(result.publicState);
        return result.attempt;
      },
    );

    const runReservedAttempt = Effect.gen(function* () {
      const attempt = yield* reserveAttempt;
      if (attempt !== null) {
        yield* runAttemptWithRetries(attempt);
      }
    });

    const runCycle = Effect.gen(function* () {
      const state = yield* SynchronizedRef.get(ref);
      if (!state.enabled) {
        return;
      }

      if (yield* readyNow) {
        if (
          state.credentials === null &&
          !(yield* captureCredentials({ reportFailure: true }))
        ) {
          return;
        }
        yield* markReadySuccess();
        return;
      }

      if (state.phase.tag === "stopped") {
        return;
      }

      if (state.loggedOutSince === undefined && canRelogin(state)) {
        const loggedIn = yield* auth
          .isLoggedIn()
          .pipe(Effect.catchCause(() => Effect.succeed(false)));
        if (!loggedIn) {
          yield* markLoggedOut(yield* Clock.currentTimeMillis);
        }
      }

      const nextState = yield* SynchronizedRef.get(ref);
      if (nextState.loggedOutSince !== undefined) {
        yield* runReservedAttempt;
      }
    });

    const disposeConnection = yield* events.on(
      { type: "connection" },
      (event) =>
        Effect.gen(function* () {
          if (event.type !== "connection") {
            return;
          }

          if (
            event.payload.status === "OnConnectionLost" ||
            event.payload.status === "OnConnectionFailed"
          ) {
            yield* markLoggedOut(yield* Clock.currentTimeMillis);
            return;
          }

          if (event.payload.status === "OnConnection") {
            const state = yield* SynchronizedRef.get(ref);
            if (state.enabled && state.credentials === null) {
              yield* captureCredentials();
            }

            yield* updateState((state) => {
              if (state.phase.tag === "attempting") {
                state.phase = {
                  ...state.phase,
                  step: "ready",
                };
              }
            });
          }
        }),
    );
    yield* Effect.addFinalizer(() => Effect.sync(disposeConnection));

    yield* Effect.forkScoped(
      Effect.forever(
        runCycle.pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning({
              cause,
              message: "autorelogin cycle failed",
            }),
          ),
          Effect.andThen(Effect.sleep("1 second")),
        ),
      ),
    );

    const setEnabled: AutoReloginShape["setEnabled"] = (enabled) =>
      enabled
        ? Effect.gen(function* () {
            yield* updateState((state) => {
              state.enabled = true;
              state.lastError = undefined;
              state.attemptsRemaining = undefined;
              if (state.phase.tag === "stopped") {
                setIdleOrWaiting(state);
              }
            });
            yield* captureCredentials({ reportFailure: true });
            return yield* snapshot;
          })
        : updateState((state) => {
            state.enabled = false;
            state.phase = { tag: "idle" };
            state.attemptId += 1;
            state.lastError = undefined;
            state.attemptsRemaining = undefined;
            state.loggedOutSince = undefined;
          });

    const setServer: AutoReloginShape["setServer"] = (serverName) =>
      Effect.gen(function* () {
        const normalized = serverName.trim();
        if (normalized === "") {
          return yield* updateState((state) => {
            state.server = undefined;
            state.lastError = undefined;
            state.attemptsRemaining = undefined;
            state.loggedOutSince = undefined;
            state.attemptId += 1;
            state.phase = { tag: "idle" };
          });
        }

        const servers = yield* auth
          .getServers()
          .pipe(Effect.catchCause(() => Effect.succeed([])));
        const selected =
          servers.length === 0 ? undefined : findServer(servers, normalized);
        const canonicalName = selected?.name ?? normalized;

        return yield* updateState((state) => {
          state.server = canonicalName;
          state.lastError =
            servers.length > 0 && selected === undefined
              ? `${normalized}: server unavailable`
              : undefined;
          state.attemptsRemaining = undefined;
          if (state.phase.tag === "attempting") {
            state.attemptId += 1;
          }
          setIdleOrWaiting(state);
        });
      });

    return AutoRelogin.of({
      disable: () => setEnabled(false),
      enable: () => setEnabled(true),
      getDelay: () => snapshot.pipe(Effect.map((state) => state.delayMs)),
      getServer: () => snapshot.pipe(Effect.map((state) => state.server)),
      getState: () => snapshot,
      isEnabled: () => snapshot.pipe(Effect.map((state) => state.enabled)),
      onState: (listener, options) => listeners.on(snapshot, listener, options),
      setDelay: (delayMs) =>
        updateState((state) => {
          state.delayMs = normalizeDelayMs(delayMs);
          state.lastError = undefined;
          state.attemptsRemaining = undefined;
          if (state.phase.tag === "stopped") {
            setIdleOrWaiting(state);
          }
        }),
      setEnabled,
      setServer,
    });
  }),
);
