import { watchFile, unwatchFile, type Stats } from "fs";

import { webContents } from "electron";

import * as Effect from "effect/Effect";

import { DesktopObservability } from "./DesktopObservability";
import { reloadUsableRendererContents } from "./DesktopDevRendererReloadContents";

const RELOAD_WATCH_INTERVAL_MS = 100;

const shouldIgnoreReloadFileChange = (
  current: Stats,
  previous: Stats,
): boolean =>
  current.mtimeMs === 0 ||
  (current.mtimeMs === previous.mtimeMs && current.size === previous.size);

// The global registry includes detached BrowserViews, such as the preloaded
// group-controls view while its popover is closed.
const reloadOpenRendererContents = (): number =>
  reloadUsableRendererContents(webContents.getAllWebContents());

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

    const rendererCount = reloadOpenRendererContents();
    void runPromise(
      observability.info("dev", "Renderer reload requested", {
        reloadPath,
        rendererCount,
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
