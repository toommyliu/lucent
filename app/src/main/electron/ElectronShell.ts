import { shell } from "electron";

import { Context, Effect, Layer } from "effect";

export interface ElectronShellShape {
  readonly openExternal: (url: URL) => Effect.Effect<boolean>;
  readonly openPath: (path: string) => Effect.Effect<boolean>;
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

export const layer = Layer.succeed(
  ElectronShell,
  ElectronShell.of({
    openExternal,
    openPath,
  }),
);
