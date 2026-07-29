import type { EventEmitter } from "events";

import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";

import { DesktopObservability } from "./DesktopObservability";
import { ElectronApp } from "../electron/ElectronApp";

const SIGNAL_FORCE_EXIT_AFTER_MS = 1_500;
const TERMINATION_SIGNALS = ["SIGHUP", "SIGINT", "SIGTERM"] as const;

export interface DesktopLifecycleShape {
  readonly awaitQuit: Effect.Effect<void>;
  readonly register: Effect.Effect<
    void,
    never,
    DesktopObservability | Scope.Scope | ElectronApp
  >;
}

export class DesktopLifecycle extends Context.Service<
  DesktopLifecycle,
  DesktopLifecycleShape
>()("lucent/desktop/app/DesktopLifecycle") {}

const addProcessSignalListener = (
  signal: NodeJS.Signals,
  listener: () => void,
): Effect.Effect<void, never, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.sync(() => {
      (process as EventEmitter).once(signal, listener);
    }),
    () =>
      Effect.sync(() => {
        (process as EventEmitter).removeListener(signal, listener);
      }),
  ).pipe(Effect.asVoid);

export const layer = Layer.effect(
  DesktopLifecycle,
  Effect.gen(function* () {
    const quitRequested = yield* Deferred.make<void>();

    const register = Effect.gen(function* () {
      const app = yield* ElectronApp;
      const observability = yield* DesktopObservability;
      const context = yield* Effect.context<
        DesktopObservability | Scope.Scope | ElectronApp
      >();
      const runFork = Effect.runForkWith(context);
      const runPromise = Effect.runPromiseWith(context);
      let forceExitTimer: NodeJS.Timeout | undefined;
      let receivedSignal: NodeJS.Signals | null = null;

      const clearForceExitTimer = (): void => {
        if (forceExitTimer !== undefined) {
          clearTimeout(forceExitTimer);
          forceExitTimer = undefined;
        }
      };
      yield* Effect.addFinalizer(() => Effect.sync(clearForceExitTimer));

      const disposeWillQuit = yield* app.on("will-quit", () => {
        clearForceExitTimer();
        runFork(Deferred.succeed(quitRequested, undefined));
      });
      yield* Effect.addFinalizer(() => Effect.sync(disposeWillQuit));

      const disposeWindowAllClosed = yield* app.on("window-all-closed", () => {
        if (process.platform !== "darwin") {
          runFork(app.quit);
        }
      });
      yield* Effect.addFinalizer(() => Effect.sync(disposeWindowAllClosed));

      for (const signal of TERMINATION_SIGNALS) {
        yield* addProcessSignalListener(signal, () => {
          if (receivedSignal !== null) {
            return;
          }

          receivedSignal = signal;
          void runPromise(
            observability.warn("lifecycle", "Received termination signal", {
              signal,
            }),
          ).catch(() => undefined);
          runFork(app.quit);

          forceExitTimer = setTimeout(() => {
            void runPromise(
              observability
                .error(
                  "lifecycle",
                  "Lucent quit timed out; forcing exit",
                  undefined,
                  {
                    signal,
                    timeoutMs: SIGNAL_FORCE_EXIT_AFTER_MS,
                  },
                )
                .pipe(Effect.flatMap(() => app.exit(0))),
            ).catch(() => undefined);
          }, SIGNAL_FORCE_EXIT_AFTER_MS);
          forceExitTimer.unref?.();
        });
      }
    });

    const awaitQuit: DesktopLifecycleShape["awaitQuit"] =
      Deferred.await(quitRequested);

    return DesktopLifecycle.of({
      awaitQuit,
      register,
    });
  }),
);
