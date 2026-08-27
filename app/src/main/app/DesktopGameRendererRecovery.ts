import {
  app,
  webContents,
  type Event as ElectronEvent,
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
  "The game client was reloaded because the script stopped responding.";

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
  readonly showRecoveryPrompt: (
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
  const observedContents = new Map<number, () => void>();
  const pendingPrompts = new Set<number>();
  const unresponsiveRenderers = new Set<number>();
  let nextToken = 0;

  const hasActiveExecution = (rendererId: number): boolean =>
    (executions.get(rendererId)?.size ?? 0) > 0;

  const clearRenderer = (rendererId: number): void => {
    executions.delete(rendererId);
    pendingPrompts.delete(rendererId);
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

  const offerRecovery = (target: RecoverableGameWebContents) =>
    Effect.gen(function* () {
      const rendererId = target.id;
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
      const response = yield* dependencies.showRecoveryPrompt(parentWindowId);
      if (response !== 0) return;
      if (
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
        target.forcefullyCrashRenderer();
        // Electron documents this immediate reload sequence for recovering an
        // unresponsive renderer after the process has been forcefully ended.
        target.reload();
      });
      yield* dependencies.info("Recovered an unresponsive game renderer", {
        rendererId,
      });
    });

  const install = Effect.gen(function* () {
    const context = yield* Effect.context<never>();
    const runPromise = Effect.runPromiseWith(context);

    const observe = (contents: RecoverableGameWebContents): void => {
      if (observedContents.has(contents.id)) return;

      const handleResponsive = (): void => {
        unresponsiveRenderers.delete(contents.id);
      };
      const handleUnresponsive = (): void => {
        unresponsiveRenderers.add(contents.id);
        if (
          !hasActiveExecution(contents.id) ||
          pendingPrompts.has(contents.id)
        ) {
          return;
        }

        pendingPrompts.add(contents.id);
        void runPromise(
          offerRecovery(contents).pipe(
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
        ).catch(() => undefined);
      };
      const handleDidStartLoading = (): void => {
        clearRenderer(contents.id);
      };
      let cleanedUp = false;
      const cleanup = (): void => {
        if (cleanedUp) return;
        cleanedUp = true;
        clearRenderer(contents.id);
        contents.removeListener("responsive", handleResponsive);
        contents.removeListener("unresponsive", handleUnresponsive);
        contents.removeListener("did-start-loading", handleDidStartLoading);
        contents.removeListener("destroyed", cleanup);
        observedContents.delete(contents.id);
      };

      contents.on("responsive", handleResponsive);
      contents.on("unresponsive", handleUnresponsive);
      contents.on("did-start-loading", handleDidStartLoading);
      contents.once("destroyed", cleanup);
      observedContents.set(contents.id, cleanup);
    };

    for (const contents of dependencies.allWebContents()) observe(contents);
    const unsubscribeCreated = dependencies.onWebContentsCreated(observe);
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
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
    showRecoveryPrompt: (parentWindowId) =>
      dialog
        .showMessageBox(
          {
            buttons: ["Reload", "Keep Waiting"],
            cancelId: 1,
            defaultId: 0,
            detail:
              "Reloading stops the script and reloads only the affected game view. The script will not restart automatically.",
            message:
              "A game view stopped responding while a script was running.",
            title: "Game View Not Responding",
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
