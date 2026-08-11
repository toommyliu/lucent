import { shell } from "electron";

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

export interface ElectronShellShape {
  readonly openExternal: (url: URL) => Effect.Effect<boolean>;
  readonly openPath: (path: string) => Effect.Effect<boolean>;
  readonly showItemInFolder: (path: string) => Effect.Effect<void>;
}

export class ElectronShell extends Context.Service<
  ElectronShell,
  ElectronShellShape
>()("lucent/desktop/electron/ElectronShell") {}

const openExternal: ElectronShellShape["openExternal"] = (url) =>
  Effect.promise(() =>
    shell.openExternal(url.href).then(
      () => true,
      () => false,
    ),
  );

const openPath: ElectronShellShape["openPath"] = (path) =>
  Effect.promise(() =>
    shell.openPath(path).then(
      (message) => message === "",
      () => false,
    ),
  );

const showItemInFolder: ElectronShellShape["showItemInFolder"] = (path) =>
  Effect.sync(() => {
    shell.showItemInFolder(path);
  });

export const layer = Layer.succeed(
  ElectronShell,
  ElectronShell.of({
    openExternal,
    openPath,
    showItemInFolder,
  }),
);
