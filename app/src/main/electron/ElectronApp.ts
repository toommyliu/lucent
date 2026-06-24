import { app } from "electron";

import { Context, Effect, Layer } from "effect";

export interface ElectronAppShape {
  readonly appendCommandLineSwitch: (
    name: string,
    value?: string,
  ) => Effect.Effect<void>;
  readonly exit: (code?: number) => Effect.Effect<void>;
  readonly getVersion: Effect.Effect<string>;
  readonly isPackaged: Effect.Effect<boolean>;
  readonly on: (
    eventName: string,
    listener: (...args: readonly unknown[]) => void,
  ) => Effect.Effect<() => void>;
  readonly quit: Effect.Effect<void>;
  readonly whenReady: Effect.Effect<void>;
}

export class ElectronApp extends Context.Service<
  ElectronApp,
  ElectronAppShape
>()("lucent/desktop/electron/ElectronApp") {}

export const layer = Layer.succeed(
  ElectronApp,
  ElectronApp.of({
    appendCommandLineSwitch: (name, value) =>
      Effect.sync(() => {
        if (value === undefined) {
          app.commandLine.appendSwitch(name);
        } else {
          app.commandLine.appendSwitch(name, value);
        }
      }),
    exit: (code) =>
      Effect.sync(() => {
        app.exit(code);
      }),
    getVersion: Effect.sync(() => app.getVersion()),
    isPackaged: Effect.sync(() => app.isPackaged),
    on: (eventName, listener) =>
      Effect.sync(() => {
        app.on(eventName as never, listener as never);
        return () => {
          app.removeListener(eventName as never, listener as never);
        };
      }),
    quit: Effect.sync(() => {
      app.quit();
    }),
    whenReady: Effect.promise(() => app.whenReady()).pipe(Effect.asVoid),
  }),
);
