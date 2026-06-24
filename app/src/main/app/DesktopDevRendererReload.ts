import { watchFile, unwatchFile, type Stats } from "fs";

import { BrowserWindow } from "electron";

import { Effect } from "effect";

import { DesktopObservability } from "./DesktopObservability";
import { reloadUsableRendererWindows } from "./DesktopDevRendererReloadWindows";

const RELOAD_WATCH_INTERVAL_MS = 100;

const shouldIgnoreReloadFileChange = (
  current: Stats,
  previous: Stats,
): boolean =>
  current.mtimeMs === 0 ||
  (current.mtimeMs === previous.mtimeMs && current.size === previous.size);

const reloadOpenRendererWindows = (): number =>
  reloadUsableRendererWindows(BrowserWindow.getAllWindows());

export const installDesktopDevRendererReload = Effect.gen(function* () {
  const reloadPath = process.env["LUCENT_DEV_RENDERER_RELOAD"];
  if (reloadPath === undefined || reloadPath.trim().length === 0) {
    return;
  }

  const observability = yield* DesktopObservability;
  const context = yield* Effect.context<never>();
  const runPromise = Effect.runPromiseWith(context);
  const listener = (current: Stats, previous: Stats): void => {
    if (shouldIgnoreReloadFileChange(current, previous)) {
      return;
    }

    const windowCount = reloadOpenRendererWindows();
    void runPromise(
      observability.info("dev", "Renderer reload requested", {
        reloadPath,
        windowCount,
      }),
    ).catch(() => undefined);
  };

  yield* Effect.sync(() => {
    watchFile(reloadPath, { interval: RELOAD_WATCH_INTERVAL_MS }, listener);
  });
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      unwatchFile(reloadPath, listener);
    }),
  );
});
