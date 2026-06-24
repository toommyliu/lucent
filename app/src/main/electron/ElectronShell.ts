import { shell } from "electron";

import { Context, Effect, Layer } from "effect";

const SAFE_EXTERNAL_PROTOCOLS = new Set(["http:", "https:"]);

export const parseSafeExternalUrl = (rawUrl: unknown): string | null => {
  if (typeof rawUrl !== "string") {
    return null;
  }

  try {
    const url = new URL(rawUrl);
    return SAFE_EXTERNAL_PROTOCOLS.has(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
};

export interface ElectronShellShape {
  readonly openExternal: (rawUrl: unknown) => Effect.Effect<boolean>;
}

export class ElectronShell extends Context.Service<
  ElectronShell,
  ElectronShellShape
>()("lucent/desktop/electron/ElectronShell") {}

export const layer = Layer.succeed(
  ElectronShell,
  ElectronShell.of({
    openExternal: (rawUrl) => {
      const url = parseSafeExternalUrl(rawUrl);
      if (url === null) {
        return Effect.succeed(false);
      }

      return Effect.promise(() =>
        shell.openExternal(url).then(
          () => true,
          () => false,
        ),
      );
    },
  }),
);
