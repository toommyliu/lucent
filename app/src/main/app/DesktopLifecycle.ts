import { app } from "electron";
import { Deferred, Effect, Layer, Scope, ServiceMap } from "effect";
import { WindowService } from "../window/WindowService";

const SIGNAL_FORCE_EXIT_AFTER_MS = 1500;
const TERMINATION_SIGNALS = ["SIGTERM", "SIGINT", "SIGHUP"] as const;

export interface DesktopLifecycleShape {
  readonly register: (options: {
    readonly startupBlockedByMissingFlashPlugin: boolean;
  }) => Effect.Effect<void, never, Scope.Scope | WindowService>;
  readonly awaitQuit: Effect.Effect<void>;
}

export class DesktopLifecycle extends ServiceMap.Service<
  DesktopLifecycle,
  DesktopLifecycleShape
>()("main/DesktopLifecycle") {}

const addScopedAppListener = <Args extends readonly unknown[]>(
  eventName: string,
  listener: (...args: Args) => void,
): Effect.Effect<void, never, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.sync(() => {
      app.on(eventName as never, listener as never);
    }),
    () =>
      Effect.sync(() => {
        app.removeListener(eventName as never, listener as never);
      }),
  ).pipe(Effect.asVoid);

const addScopedProcessSignalListener = (
  signal: NodeJS.Signals,
  listener: () => void,
): Effect.Effect<void, never, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.sync(() => {
      process.once(signal as never, listener as never);
    }),
    () =>
      Effect.sync(() => {
        process.removeListener(signal as never, listener as never);
      }),
  ).pipe(Effect.asVoid);

export const DesktopLifecycleLive = Layer.effect(
  DesktopLifecycle,
  Effect.gen(function* () {
    const quitRequested = yield* Deferred.make<void>();
    let terminationForceExitTimer: NodeJS.Timeout | undefined;
    let receivedTerminationSignal: NodeJS.Signals | null = null;

    const clearTerminationForceExitTimer = (): void => {
      if (!terminationForceExitTimer) {
        return;
      }

      clearTimeout(terminationForceExitTimer);
      terminationForceExitTimer = undefined;
    };

    return {
      awaitQuit: Deferred.await(quitRequested),
      register: ({ startupBlockedByMissingFlashPlugin }) =>
        Effect.gen(function* () {
          const services = yield* Effect.services<WindowService>();
          const runPromise = Effect.runPromiseWith(services);
          const runWindowEffect = <A>(
            effect: Effect.Effect<A, unknown, WindowService>,
          ): void => {
            void runPromise(effect).catch((cause) => {
              process.stderr.write(
                `Desktop lifecycle error: ${String(cause)}\n`,
              );
            });
          };

          yield* addScopedAppListener("before-quit", () => {
            runWindowEffect(
              Effect.gen(function* () {
                const windows = yield* WindowService;
                yield* windows.setQuitting(true);
              }),
            );
          });

          yield* addScopedAppListener("will-quit", () => {
            clearTerminationForceExitTimer();
            void runPromise(Deferred.succeed(quitRequested, undefined));
          });

          yield* addScopedAppListener("window-all-closed", () => {
            if (process.platform !== "darwin") {
              app.quit();
            }
          });

          yield* addScopedAppListener("activate", () => {
            if (startupBlockedByMissingFlashPlugin) {
              return;
            }

            runWindowEffect(
              Effect.gen(function* () {
                const windows = yield* WindowService;
                yield* windows.revealWindowForAppActivation();
              }),
            );
          });

          for (const signal of TERMINATION_SIGNALS) {
            yield* addScopedProcessSignalListener(signal, () => {
              if (receivedTerminationSignal !== null) {
                return;
              }

              receivedTerminationSignal = signal;
              process.stderr.write(`Received ${signal}; quitting app.\n`);
              app.quit();

              terminationForceExitTimer = setTimeout(() => {
                process.stderr.write(
                  `App did not quit after ${SIGNAL_FORCE_EXIT_AFTER_MS}ms; forcing exit.\n`,
                );
                app.exit(0);
              }, SIGNAL_FORCE_EXIT_AFTER_MS);
              terminationForceExitTimer.unref?.();
            });
          }
        }),
    };
  }),
);
