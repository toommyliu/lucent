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
  readonly relaunch: Effect.Effect<void>;
  readonly quit: Effect.Effect<void>;
  readonly whenReady: Effect.Effect<void>;
}

export class ElectronApp extends Context.Service<
  ElectronApp,
  ElectronAppShape
>()("lucent/desktop/electron/ElectronApp") {}

const appendCommandLineSwitch: ElectronAppShape["appendCommandLineSwitch"] = (
  name,
  value,
) =>
  Effect.sync(() => {
    if (value === undefined) {
      app.commandLine.appendSwitch(name);
    } else {
      app.commandLine.appendSwitch(name, value);
    }
  });

const exit: ElectronAppShape["exit"] = (code) =>
  Effect.sync(() => {
    app.exit(code);
  });

const getVersion: ElectronAppShape["getVersion"] = Effect.sync(() =>
  app.getVersion(),
);

const isPackaged: ElectronAppShape["isPackaged"] = Effect.sync(
  () => app.isPackaged,
);

const on: ElectronAppShape["on"] = (eventName, listener) =>
  Effect.sync(() => {
    app.on(eventName as never, listener as never);
    return () => {
      app.removeListener(eventName as never, listener as never);
    };
  });

const relaunch: ElectronAppShape["relaunch"] = Effect.sync(() => {
  app.relaunch();
});

const quit: ElectronAppShape["quit"] = Effect.sync(() => {
  app.quit();
});

const whenReady: ElectronAppShape["whenReady"] = Effect.promise(() =>
  app.whenReady(),
).pipe(Effect.asVoid);

export const layer = Layer.succeed(
  ElectronApp,
  ElectronApp.of({
    appendCommandLineSwitch,
    exit,
    getVersion,
    isPackaged,
    on,
    relaunch,
    quit,
    whenReady,
  }),
);
