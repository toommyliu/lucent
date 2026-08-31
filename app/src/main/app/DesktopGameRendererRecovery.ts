import {
  app,
  webContents,
  type Event as ElectronEvent,
  type RenderProcessGoneDetails,
  type WebContents,
} from "electron";

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";

import { Accounts } from "../internal/accounts/Accounts";
import { ElectronDialog } from "../electron/ElectronDialog";
import { DesktopWindows } from "../window/DesktopWindows";
import { DesktopObservability } from "./observability/DesktopObservability";

const RECOVERY_MESSAGE =
  "The client was reloaded because the script stopped responding.";
const PLUGIN_RECOVERY_MESSAGE =
  "The client was reloaded because its Flash plugin crashed.";
const RENDERER_RECOVERY_MESSAGE = "The client was reloaded after it crashed.";
const CLIENT_RELOAD_DETAIL =
  "Only that client will reload. Any running script will stop and won't run automatically.";

type RecoverableGameCrash =
  | {
      readonly name: string;
      readonly scriptWasRunning: boolean;
      readonly type: "plugin";
      readonly version: string;
    }
  | {
      readonly reason: RenderProcessGoneDetails["reason"];
      readonly scriptWasRunning: boolean;
      readonly type: "renderer";
    };

const isRecoverableRendererCrash = (
  reason: RenderProcessGoneDetails["reason"],
): boolean =>
  reason === "abnormal-exit" ||
  reason === "crashed" ||
  reason === "killed" ||
  reason === "oom";

export type RecoverableGameWebContents = Pick<
  WebContents,
  | "forcefullyCrashRenderer"
  | "getOSProcessId"
  | "id"
  | "isDestroyed"
  | "on"
  | "once"
  | "reload"
  | "removeListener"
>;

export interface DesktopGameRendererRecoveryDependencies {
  readonly allWebContents: () => readonly RecoverableGameWebContents[];
  readonly getNativeWindowId: (
    rendererId: number,
  ) => Effect.Effect<number, unknown>;
  readonly getRendererKind: (
    rendererId: number,
  ) => Effect.Effect<string | null, unknown>;
  readonly onWebContentsCreated: (
    listener: (contents: RecoverableGameWebContents) => void,
  ) => () => void;
  readonly onBeforeQuit: (listener: () => void) => () => void;
  readonly showRecoveryPrompt: (
    parentWindowId: number | undefined,
  ) => Effect.Effect<number, unknown>;
  readonly showPluginRecoveryPrompt: (
    parentWindowId: number | undefined,
  ) => Effect.Effect<number, unknown>;
  readonly showRendererRecoveryPrompt: (
    parentWindowId: number | undefined,
  ) => Effect.Effect<number, unknown>;
  readonly suppressLaunchScript: (
    rendererId: number,
    message: string,
  ) => Effect.Effect<void, unknown>;
  readonly warn: (message: string, data?: unknown) => Effect.Effect<void>;
  readonly error: (
    message: string,
    cause: unknown,
    data?: unknown,
  ) => Effect.Effect<void>;
  readonly info: (message: string, data?: unknown) => Effect.Effect<void>;
}

export interface DesktopGameRendererRecoveryShape {
  readonly beginScriptExecution: (rendererId: number) => Effect.Effect<number>;
  readonly finishScriptExecution: (
    rendererId: number,
    token: number,
  ) => Effect.Effect<void>;
  readonly install: Effect.Effect<void, never, Scope.Scope>;
}

export class DesktopGameRendererRecovery extends Context.Service<
  DesktopGameRendererRecovery,
  DesktopGameRendererRecoveryShape
>()("lucent/desktop/app/DesktopGameRendererRecovery") {}

const isExclusiveRendererProcess = (
  target: RecoverableGameWebContents,
  allWebContents: () => readonly RecoverableGameWebContents[],
): boolean => {
  try {
    if (target.isDestroyed()) return false;
    const processId = target.getOSProcessId();
    if (processId <= 0) return false;

    return allWebContents().every((contents) => {
      if (contents.id === target.id || contents.isDestroyed()) return true;
      return contents.getOSProcessId() !== processId;
    });
  } catch {
    return false;
  }
};

export const makeDesktopGameRendererRecovery = (
  dependencies: DesktopGameRendererRecoveryDependencies,
): DesktopGameRendererRecovery["Service"] => {
  const executions = new Map<number, Set<number>>();
  const intentionalRendererCrashes = new Set<number>();
  const observedContents = new Map<number, () => void>();
  const pendingPrompts = new Set<number>();
  const recoverableCrashes = new Map<number, RecoverableGameCrash>();
  const unresponsiveRenderers = new Set<number>();
  let appIsQuitting = false;
  let nextToken = 0;

  const hasActiveExecution = (rendererId: number): boolean =>
    (executions.get(rendererId)?.size ?? 0) > 0;

  const clearRenderer = (rendererId: number): void => {
    executions.delete(rendererId);
    pendingPrompts.delete(rendererId);
    recoverableCrashes.delete(rendererId);
    unresponsiveRenderers.delete(rendererId);
  };

  const beginScriptExecution: DesktopGameRendererRecoveryShape["beginScriptExecution"] =
    (rendererId) =>
      Effect.sync(() => {
        nextToken += 1;
        const active = executions.get(rendererId) ?? new Set<number>();
        active.add(nextToken);
        executions.set(rendererId, active);
        return nextToken;
      });

  const finishScriptExecution: DesktopGameRendererRecoveryShape["finishScriptExecution"] =
    (rendererId, token) =>
      Effect.sync(() => {
        const active = executions.get(rendererId);
        active?.delete(token);
        if (active?.size === 0) executions.delete(rendererId);
      });

  const offerUnresponsiveRecovery = (target: RecoverableGameWebContents) =>
    Effect.gen(function* () {
      const rendererId = target.id;
      if (appIsQuitting) return;

      const kind = yield* dependencies
        .getRendererKind(rendererId)
        .pipe(Effect.catch(() => Effect.succeed(null)));
      if (kind !== "game" || !hasActiveExecution(rendererId)) return;

      if (!isExclusiveRendererProcess(target, dependencies.allWebContents)) {
        yield* dependencies.warn(
          "Refused to recover an unresponsive game renderer because its process is shared",
          { rendererId },
        );
        return;
      }

      const parentWindowId = yield* dependencies
        .getNativeWindowId(rendererId)
        .pipe(
          Effect.match({
            onFailure: (): undefined => undefined,
            onSuccess: (id): number => id,
          }),
        );
      if (appIsQuitting) return;

      const response = yield* dependencies.showRecoveryPrompt(parentWindowId);
      if (response !== 0) return;
      if (
        appIsQuitting ||
        !unresponsiveRenderers.has(rendererId) ||
        !hasActiveExecution(rendererId) ||
        target.isDestroyed() ||
        !isExclusiveRendererProcess(target, dependencies.allWebContents)
      ) {
        return;
      }

      yield* dependencies
        .suppressLaunchScript(rendererId, RECOVERY_MESSAGE)
        .pipe(
          Effect.catch((cause) =>
            dependencies.error(
              "Failed to suppress a script before renderer recovery",
              cause,
              { rendererId },
            ),
          ),
        );
      clearRenderer(rendererId);
      yield* Effect.sync(() => {
        intentionalRendererCrashes.add(rendererId);
        target.forcefullyCrashRenderer();
        // Electron documents this immediate reload sequence for recovering an
        // unresponsive renderer after the process has been forcefully ended.
        target.reload();
      });
      yield* dependencies.info("Recovered an unresponsive game renderer", {
        rendererId,
      });
    });

  const offerCrashRecovery = (
    target: RecoverableGameWebContents,
    crash: RecoverableGameCrash,
  ) =>
    Effect.gen(function* () {
      const rendererId = target.id;
      if (appIsQuitting) return;

      const kind = yield* dependencies
        .getRendererKind(rendererId)
        .pipe(Effect.catch(() => Effect.succeed(null)));
      if (kind !== "game") return;

      if (crash.type === "plugin") {
        yield* dependencies.warn("Flash plugin crashed", {
          name: crash.name,
          rendererId,
          version: crash.version,
        });
      } else {
        yield* dependencies.warn("Game renderer crashed", {
          reason: crash.reason,
          rendererId,
        });
      }

      const parentWindowId = yield* dependencies
        .getNativeWindowId(rendererId)
        .pipe(
          Effect.match({
            onFailure: (): undefined => undefined,
            onSuccess: (id): number => id,
          }),
        );
      if (appIsQuitting) return;

      const response = yield* crash.type === "plugin"
        ? dependencies.showPluginRecoveryPrompt(parentWindowId)
        : dependencies.showRendererRecoveryPrompt(parentWindowId);
      if (response !== 0) return;
      if (
        appIsQuitting ||
        recoverableCrashes.get(rendererId) !== crash ||
        target.isDestroyed()
      ) {
        return;
      }

      if (crash.scriptWasRunning) {
        yield* dependencies
          .suppressLaunchScript(
            rendererId,
            crash.type === "plugin"
              ? PLUGIN_RECOVERY_MESSAGE
              : RENDERER_RECOVERY_MESSAGE,
          )
          .pipe(
            Effect.catch((cause) =>
              dependencies.error(
                crash.type === "plugin"
                  ? "Failed to suppress a script before Flash plugin recovery"
                  : "Failed to suppress a script before renderer crash recovery",
                cause,
                { rendererId },
              ),
            ),
          );
      }
      clearRenderer(rendererId);
      yield* Effect.sync(() => target.reload());
      yield* dependencies.info(
        crash.type === "plugin"
          ? "Recovered a crashed Flash plugin"
          : "Recovered a crashed game renderer",
        crash.type === "plugin"
          ? {
              name: crash.name,
              rendererId,
              version: crash.version,
            }
          : { reason: crash.reason, rendererId },
      );
    });

  const install = Effect.gen(function* () {
    const context = yield* Effect.context<never>();
    const runPromise = Effect.runPromiseWith(context);
    const unsubscribeBeforeQuit = dependencies.onBeforeQuit(() => {
      appIsQuitting = true;
    });

    const observe = (contents: RecoverableGameWebContents): void => {
      if (observedContents.has(contents.id)) return;

      const startCrashRecovery = (): void => {
        if (
          appIsQuitting ||
          pendingPrompts.has(contents.id) ||
          contents.isDestroyed()
        ) {
          return;
        }
        const crash = recoverableCrashes.get(contents.id);
        if (crash === undefined) return;

        pendingPrompts.add(contents.id);
        void runPromise(
          offerCrashRecovery(contents, crash).pipe(
            Effect.catchCause((cause) =>
              dependencies.error(
                crash.type === "plugin"
                  ? "Failed to offer Flash plugin recovery"
                  : "Failed to offer renderer crash recovery",
                cause,
                { rendererId: contents.id },
              ),
            ),
            Effect.ensuring(
              Effect.sync(() => pendingPrompts.delete(contents.id)),
            ),
          ),
        )
          .then(() => {
            if (recoverableCrashes.get(contents.id) === crash) {
              recoverableCrashes.delete(contents.id);
            }
            startCrashRecovery();
          })
          .catch(() => undefined);
      };
      const handleResponsive = (): void => {
        unresponsiveRenderers.delete(contents.id);
      };
      const handleUnresponsive = (): void => {
        if (appIsQuitting) return;

        unresponsiveRenderers.add(contents.id);
        if (
          !hasActiveExecution(contents.id) ||
          pendingPrompts.has(contents.id)
        ) {
          return;
        }

        pendingPrompts.add(contents.id);
        void runPromise(
          offerUnresponsiveRecovery(contents).pipe(
            Effect.catchCause((cause) =>
              dependencies.error(
                "Failed to offer game renderer recovery",
                cause,
                { rendererId: contents.id },
              ),
            ),
            Effect.ensuring(
              Effect.sync(() => pendingPrompts.delete(contents.id)),
            ),
          ),
        )
          .then(() => {
            startCrashRecovery();
          })
          .catch(() => undefined);
      };
      const handlePluginCrashed = (
        _event: ElectronEvent,
        name: string,
        version: string,
      ): void => {
        if (appIsQuitting) return;

        const current = recoverableCrashes.get(contents.id);
        if (current?.type !== "renderer") {
          recoverableCrashes.set(
            contents.id,
            current ?? {
              name,
              scriptWasRunning: hasActiveExecution(contents.id),
              type: "plugin",
              version,
            },
          );
        }
        startCrashRecovery();
      };
      const handleRenderProcessGone = (
        _event: ElectronEvent,
        details: RenderProcessGoneDetails,
      ): void => {
        // Unresponsive recovery deliberately kills the renderer before
        // reloading it, so that event must not open another recovery prompt.
        if (intentionalRendererCrashes.delete(contents.id)) return;
        if (appIsQuitting || !isRecoverableRendererCrash(details.reason)) {
          return;
        }

        const current = recoverableCrashes.get(contents.id);
        recoverableCrashes.set(
          contents.id,
          current?.type === "renderer"
            ? current
            : {
                reason: details.reason,
                scriptWasRunning:
                  current?.scriptWasRunning ?? hasActiveExecution(contents.id),
                type: "renderer",
              },
        );
        startCrashRecovery();
      };
      const handleDidStartLoading = (): void => {
        clearRenderer(contents.id);
      };
      let cleanedUp = false;
      const cleanup = (): void => {
        if (cleanedUp) return;
        cleanedUp = true;
        clearRenderer(contents.id);
        intentionalRendererCrashes.delete(contents.id);
        contents.removeListener("responsive", handleResponsive);
        contents.removeListener("unresponsive", handleUnresponsive);
        contents.removeListener("plugin-crashed", handlePluginCrashed);
        contents.removeListener("render-process-gone", handleRenderProcessGone);
        contents.removeListener("did-start-loading", handleDidStartLoading);
        contents.removeListener("destroyed", cleanup);
        observedContents.delete(contents.id);
      };

      contents.on("responsive", handleResponsive);
      contents.on("unresponsive", handleUnresponsive);
      contents.on("plugin-crashed", handlePluginCrashed);
      contents.on("render-process-gone", handleRenderProcessGone);
      contents.on("did-start-loading", handleDidStartLoading);
      contents.once("destroyed", cleanup);
      observedContents.set(contents.id, cleanup);
    };

    for (const contents of dependencies.allWebContents()) observe(contents);
    const unsubscribeCreated = dependencies.onWebContentsCreated(observe);
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        unsubscribeBeforeQuit();
        unsubscribeCreated();
        for (const cleanup of observedContents.values()) cleanup();
      }),
    );
  });

  return DesktopGameRendererRecovery.of({
    beginScriptExecution,
    finishScriptExecution,
    install,
  });
};

const makeLiveDesktopGameRendererRecovery = Effect.gen(function* () {
  const accounts = yield* Accounts;
  const dialog = yield* ElectronDialog;
  const observability = yield* DesktopObservability;
  const windows = yield* DesktopWindows;

  return makeDesktopGameRendererRecovery({
    allWebContents: () => webContents.getAllWebContents(),
    getNativeWindowId: windows.getNativeWindowId,
    getRendererKind: windows.getRendererKind,
    onWebContentsCreated: (listener) => {
      const handleCreated = (
        _event: ElectronEvent,
        contents: WebContents,
      ): void => listener(contents);
      app.on("web-contents-created", handleCreated);
      return () => app.removeListener("web-contents-created", handleCreated);
    },
    onBeforeQuit: (listener) => {
      const handleBeforeQuit = (): void => listener();
      app.on("before-quit", handleBeforeQuit);
      return () => app.removeListener("before-quit", handleBeforeQuit);
    },
    showRecoveryPrompt: (parentWindowId) =>
      dialog
        .showMessageBox(
          {
            buttons: ["Reload", "Keep Waiting"],
            cancelId: 1,
            defaultId: 0,
            detail: CLIENT_RELOAD_DETAIL,
            message: "A client stopped responding while a script was running.",
            title: "Client Not Responding",
            type: "warning",
          },
          parentWindowId,
        )
        .pipe(Effect.map((result) => result.response)),
    showPluginRecoveryPrompt: (parentWindowId) =>
      dialog
        .showMessageBox(
          {
            buttons: ["Reload", "Not Now"],
            cancelId: 1,
            defaultId: 0,
            detail: CLIENT_RELOAD_DETAIL,
            message: "The Flash plugin for a client crashed.",
            title: "Flash Plugin Crashed",
            type: "warning",
          },
          parentWindowId,
        )
        .pipe(Effect.map((result) => result.response)),
    showRendererRecoveryPrompt: (parentWindowId) =>
      dialog
        .showMessageBox(
          {
            buttons: ["Reload", "Not Now"],
            cancelId: 1,
            defaultId: 0,
            detail: CLIENT_RELOAD_DETAIL,
            message: "A client crashed.",
            title: "Client Crashed",
            type: "warning",
          },
          parentWindowId,
        )
        .pipe(Effect.map((result) => result.response)),
    suppressLaunchScript: accounts.suppressGameWindowLaunchScript,
    warn: (message, data) =>
      observability.warn("game-renderer-recovery", message, data),
    error: (message, cause, data) =>
      observability.error("game-renderer-recovery", message, cause, data),
    info: (message, data) =>
      observability.info("game-renderer-recovery", message, data),
  });
});

export const layer = Layer.effect(
  DesktopGameRendererRecovery,
  makeLiveDesktopGameRendererRecovery,
);
