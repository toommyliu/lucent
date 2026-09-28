import { resolve } from "node:path";
import { ipcMain, type IpcMainEvent } from "electron";
import * as Context from "effect/Context";
import * as Exit from "effect/Exit";
import * as FiberSet from "effect/FiberSet";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";

import type { AccountManagerState } from "@lucent/core/accounts";
import { GameConsoleIpc } from "../../../shared/ipc";
import { Accounts } from "../../internal/accounts/Accounts";
import { DesktopWindows } from "../../window/DesktopWindows";
import { DesktopObservability } from "./DesktopObservability";
import {
  makeGameConsoleStore,
  sessionsFromAccountState,
} from "./GameConsoleStore";

import {
  type SseClient,
  publishSseEvent,
  startDesktopObservabilityHttpServer,
} from "./DesktopObservabilityHttp";

export const DEFAULT_DESKTOP_OBSERVABILITY_PORT = 10_637;

const DEFAULT_OBSERVABILITY_ASSET_ROOT = resolve(
  __dirname,
  "..",
  "observability",
);
export interface DesktopObservabilityServerOptions {
  readonly port: number;
}

export interface DesktopObservabilityServerInstall {
  readonly port: number;
  readonly url: string;
}

export class DesktopObservabilityServerStartError extends Schema.TaggedError<DesktopObservabilityServerStartError>()(
  "DesktopObservabilityServerStartError",
  {
    port: Schema.Number,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to start the desktop observability server on port ${this.port}.`;
  }
}

const decodeRendererMessagePayload = Option.liftThrowable(
  GameConsoleIpc.rendererMessage.decodePayload,
);

export interface DesktopObservabilityServerShape {
  readonly install: (
    options: DesktopObservabilityServerOptions,
  ) => Effect.Effect<
    DesktopObservabilityServerInstall,
    DesktopObservabilityServerStartError,
    Scope.Scope
  >;
}

export class DesktopObservabilityServer extends Context.Service<
  DesktopObservabilityServer,
  DesktopObservabilityServerShape
>()("lucent/desktop/app/observability/DesktopObservabilityServer") {}

const makeDesktopObservabilityServer = Effect.gen(function* () {
  const accounts = yield* Accounts;
  const observability = yield* DesktopObservability;
  const windows = yield* DesktopWindows;

  const install: DesktopObservabilityServerShape["install"] = Effect.fn(
    "DesktopObservabilityServer.install",
  )(function* (options) {
    const installScope = yield* Scope.fork(yield* Effect.scope);
    return yield* Effect.gen(function* () {
      const store = makeGameConsoleStore();
      const consoleClients = new Set<SseClient>();
      const traceClients = new Set<SseClient>();
      const publishConsole = (event: string, data: unknown): void => {
        publishSseEvent(consoleClients, event, data);
      };
      const applyAccountState = (state: AccountManagerState): void => {
        for (const windowState of store.updateSessions(
          sessionsFromAccountState(state),
        )) {
          publishConsole("session-updated", windowState);
        }
      };
      const run = yield* FiberSet.makeRuntime<never, void>();
      const handleRendererMessage = (
        event: IpcMainEvent,
        rawPayload: unknown,
      ): void => {
        const decodedPayload = decodeRendererMessagePayload(rawPayload);
        if (Option.isNone(decodedPayload)) {
          return;
        }
        const payload = decodedPayload.value;
        const rendererId = event.sender.id;

        run(
          windows.getRendererKind(rendererId).pipe(
            Effect.flatMap((kind) =>
              kind === "game"
                ? observability
                    .record({
                      component: "renderer",
                      event: "console",
                      data: {
                        message: payload.message,
                        rendererId,
                        view: kind,
                      },
                    })
                    .pipe(
                      Effect.flatMap(() =>
                        Effect.sync(() => {
                          const row = store.appendMessage({
                            gameWindowId: rendererId,
                            message: payload.message,
                          });
                          publishConsole("message", row);
                        }),
                      ),
                    )
                : Effect.void,
            ),
            Effect.catch(() => Effect.void),
          ),
        );
      };

      const unsubscribeCreated = yield* windows.onCreated((event) => {
        if (event.kind !== "game") {
          return Effect.void;
        }

        return Effect.sync(() => {
          const windowState = store.openWindow(
            event.rendererId,
            undefined,
            event.generation,
          );
          publishConsole("window-opened", windowState);
        });
      });
      yield* Effect.addFinalizer(() => Effect.sync(unsubscribeCreated));
      const unsubscribeReloaded = yield* windows.onRendererReloaded((event) => {
        if (event.kind !== "game") {
          return Effect.void;
        }

        return Effect.sync(() => {
          const windowState = store.beginWindowGeneration(
            event.rendererId,
            event.generation,
          );
          publishConsole("window-generation", windowState);
        });
      });
      yield* Effect.addFinalizer(() => Effect.sync(unsubscribeReloaded));
      const unsubscribeClosed = yield* windows.onClosed((event) => {
        if (event.kind !== "game") {
          return Effect.void;
        }

        return Effect.sync(() => {
          const windowState = store.closeWindow(event.rendererId);
          publishConsole("window-closed", windowState);
        });
      });
      yield* Effect.addFinalizer(() => Effect.sync(unsubscribeClosed));
      const initialState = yield* accounts.getState.pipe(
        Effect.catch(() => Effect.succeed(null)),
      );
      if (initialState !== null) {
        yield* Effect.sync(() => {
          applyAccountState(initialState);
        });
      }
      const unsubscribeAccounts = yield* accounts.onChanged((state) => {
        applyAccountState(state);
      });
      yield* Effect.addFinalizer(() => Effect.sync(unsubscribeAccounts));
      yield* Effect.sync(() => {
        ipcMain.on(
          GameConsoleIpc.rendererMessage.channel,
          handleRendererMessage,
        );
      });

      const unsubscribeTraces = observability.subscribeTrace((span) => {
        publishSseEvent(traceClients, "span", span);
      });
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          unsubscribeTraces();
          ipcMain.removeListener(
            GameConsoleIpc.rendererMessage.channel,
            handleRendererMessage,
          );
        }),
      );
      const installed = yield* startDesktopObservabilityHttpServer(store, {
        port: options.port,
        assetRoot: DEFAULT_OBSERVABILITY_ASSET_ROOT,
        consoleClients,
        traceClients,
        traceSnapshot: observability.traceSnapshot,
      }).pipe(
        Effect.mapError(
          (cause) =>
            new DesktopObservabilityServerStartError({
              cause,
              port: options.port,
            }),
        ),
      );

      console.info(
        `[observability] Desktop observability server listening on ${installed.url}`,
      );
      yield* Effect.logInfo("Desktop observability server listening").pipe(
        Effect.annotateLogs({
          component: "observability-server",
          data: {
            port: installed.port,
            url: installed.url,
          },
        }),
      );

      return installed;
    }).pipe(
      Scope.provide(installScope),
      Effect.onExit((exit) =>
        Exit.isFailure(exit) ? Scope.close(installScope, exit) : Effect.void,
      ),
    );
  });

  return DesktopObservabilityServer.of({ install });
});

export const layer = Layer.effect(
  DesktopObservabilityServer,
  makeDesktopObservabilityServer,
);
