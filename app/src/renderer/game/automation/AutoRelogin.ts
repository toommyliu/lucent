import {
  Data,
  Effect,
  FiberMap,
  Number as EffectNumber,
  Result,
  Stream,
  SubscriptionRef,
  type FiberMap as FiberMapType,
} from "effect";

import type { ApiService } from "../flash/api/Api";

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

export type AutoReloginLifecycleStep = "connect" | "login" | "ready";
export interface AutoReloginLifecycleEvent {
  readonly attemptsRemaining: number;
  readonly message?: string;
  readonly step: AutoReloginLifecycleStep;
}
export interface AutoReloginLoginRequest {
  readonly onLifecycle?: (
    event: AutoReloginLifecycleEvent,
  ) => Effect.Effect<void, unknown>;
  readonly password: string;
  readonly server?: string;
  readonly username: string;
}
export type AutoReloginLoginResult =
  | { readonly status: "ready" }
  | { readonly status: "server-select" };

export class AutoReloginLoginError extends Data.TaggedError(
  "AutoReloginLoginError",
)<{ readonly detail: string }> {
  override get message(): string {
    return this.detail;
  }
}

interface State {
  attemptsRemaining: number | undefined;
  attempting: boolean;
  delayMs: number;
  enabled: boolean;
  lastError: string | undefined;
  password: string | undefined;
  server: string | undefined;
  username: string | undefined;
  waitingDelay: boolean;
}

const key = "auto-relogin";
const maximumRetries = 3;
const defaultDelay = 3_000;

export const normalizeAutoReloginDelay = (delayMs: number): number =>
  Number.isFinite(delayMs)
    ? EffectNumber.clamp({ minimum: 0, maximum: 300_000 })(delayMs)
    : defaultDelay;

const publicState = (state: State): AutoReloginState => ({
  attempting: state.attempting,
  captured: state.username !== undefined && state.password !== undefined,
  delayMs: state.delayMs,
  enabled: state.enabled,
  waitingDelay: state.waitingDelay,
  ...(state.attemptsRemaining === undefined
    ? {}
    : { attemptsRemaining: state.attemptsRemaining }),
  ...(state.lastError === undefined ? {} : { lastError: state.lastError }),
  ...(state.server === undefined ? {} : { server: state.server }),
  ...(state.username === undefined ? {} : { username: state.username }),
});

const lifecycle = (
  request: AutoReloginLoginRequest,
  step: AutoReloginLifecycleStep,
  attemptsRemaining: number,
  message?: string,
) =>
  request
    .onLifecycle?.({
      attemptsRemaining,
      step,
      ...(message === undefined ? {} : { message }),
    })
    .pipe(Effect.catchCause(() => Effect.void)) ?? Effect.void;

export const makeAutoRelogin = Effect.fnUntraced(function* (
  api: ApiService,
  fibers: FiberMapType.FiberMap<string>,
) {
  const state = yield* SubscriptionRef.make<State>({
    attemptsRemaining: undefined,
    attempting: false,
    delayMs: defaultDelay,
    enabled: false,
    lastError: undefined,
    password: undefined,
    server: undefined,
    username: undefined,
    waitingDelay: false,
  });
  const getState = () =>
    SubscriptionRef.get(state).pipe(Effect.map(publicState));

  const changes = SubscriptionRef.changes(state).pipe(Stream.map(publicState));
  const runLogin = (
    request: AutoReloginLoginRequest,
  ): Effect.Effect<AutoReloginLoginResult, AutoReloginLoginError> => {
    const attempt = (
      remaining: number,
    ): Effect.Effect<AutoReloginLoginResult, AutoReloginLoginError> =>
      Effect.gen(function* () {
        if (request.server === undefined || request.server.trim() === "") {
          return { status: "server-select" as const };
        }
        yield* lifecycle(request, "connect", remaining);
        const selected = yield* api.auth.connectTo(request.server);
        if (selected.status !== "connected") {
          if (selected.retryable && remaining > 1) {
            yield* lifecycle(
              request,
              "connect",
              remaining - 1,
              selected.message,
            );
            yield* Effect.sleep("1 second");
            return yield* attempt(remaining - 1);
          }
          return yield* new AutoReloginLoginError({ detail: selected.message });
        }

        yield* lifecycle(request, "login", remaining);
        const sent = yield* api.auth.login(request.username, request.password);
        if (!sent) {
          if (remaining > 1) return yield* attempt(remaining - 1);
          return yield* new AutoReloginLoginError({
            detail: "Login was rejected",
          });
        }
        yield* lifecycle(request, "ready", remaining);
        const ready = yield* api.wait.until(api.player.isReady(), {
          timeout: "10 seconds",
        });
        if (ready) return { status: "ready" as const };
        yield* api.auth.logout();
        if (remaining > 1) return yield* attempt(remaining - 1);
        return yield* new AutoReloginLoginError({
          detail: "Player did not become ready",
        });
      });
    return attempt(maximumRetries);
  };

  const monitor = Effect.forever(
    Effect.gen(function* () {
      const current = yield* SubscriptionRef.get(state);
      if (!current.enabled) return yield* Effect.sleep("1 second");
      if (yield* api.auth.isLoggedIn()) {
        const username = yield* api.auth.getUsername();
        const password = yield* api.auth.getPassword();
        if (username !== "" && password !== "") {
          yield* SubscriptionRef.update(state, (value) => ({
            ...value,
            attemptsRemaining: undefined,
            attempting: false,
            lastError: undefined,
            password,
            username,
            waitingDelay: false,
          }));
        }
        return yield* Effect.sleep("1 second");
      }
      if (
        current.username === undefined ||
        current.password === undefined ||
        current.server === undefined
      ) {
        return yield* Effect.sleep("1 second");
      }

      yield* SubscriptionRef.update(state, (value) => ({
        ...value,
        waitingDelay: true,
      }));
      yield* Effect.sleep(current.delayMs);
      const latest = yield* SubscriptionRef.get(state);
      if (!latest.enabled) return;
      yield* SubscriptionRef.update(state, (value) => ({
        ...value,
        attemptsRemaining: maximumRetries,
        attempting: true,
        waitingDelay: false,
      }));
      const result = yield* Effect.result(
        runLogin({
          password: current.password,
          server: current.server,
          username: current.username,
        }),
      );
      yield* SubscriptionRef.update(
        state,
        Result.match(result, {
          onSuccess: () => (value) => ({
            ...value,
            attemptsRemaining: undefined,
            attempting: false,
            lastError: undefined,
          }),
          onFailure: (failure) => (value) => ({
            ...value,
            attemptsRemaining: 0,
            attempting: false,
            lastError: failure.detail.replaceAll(
              current.password ?? "",
              "[redacted]",
            ),
          }),
        }),
      );
      yield* Effect.sleep("5 seconds");
    }),
  );

  const stop = () =>
    FiberMap.remove(fibers, key).pipe(
      Effect.andThen(
        SubscriptionRef.update(state, (current) => ({
          ...current,
          attempting: false,
          enabled: false,
          waitingDelay: false,
        })),
      ),
      Effect.andThen(getState()),
    );

  const start = () =>
    SubscriptionRef.update(state, (current) => ({
      ...current,
      enabled: true,
    })).pipe(
      Effect.andThen(FiberMap.run(fibers, key, monitor)),
      Effect.andThen(getState()),
    );

  const getDelay = () =>
    SubscriptionRef.get(state).pipe(Effect.map((current) => current.delayMs));

  const getServer = () =>
    SubscriptionRef.get(state).pipe(Effect.map((current) => current.server));

  const isEnabled = () =>
    SubscriptionRef.get(state).pipe(Effect.map((current) => current.enabled));

  const setDelay = (delayMs: number) =>
    SubscriptionRef.update(state, (current) => ({
      ...current,
      delayMs: normalizeAutoReloginDelay(delayMs),
    })).pipe(Effect.andThen(getState()));

  const setEnabled = (enabled: boolean) => (enabled ? start() : stop());

  const setServer = (server: string) =>
    SubscriptionRef.update(state, (current) => ({
      ...current,
      server: server.trim() || undefined,
    })).pipe(Effect.andThen(getState()));

  return {
    changes,
    disable: stop,
    enable: start,
    getDelay,
    getServer,
    getState,
    isEnabled,
    runLogin,
    setDelay,
    setEnabled,
    setServer,
  };
});

export type AutoRelogin = Effect.Success<ReturnType<typeof makeAutoRelogin>>;
