import { nativeTheme } from "electron";

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { ThemeModeSchema, type ThemeMode } from "@lucent/core/settings";

export class ElectronThemeError extends Schema.TaggedError<ElectronThemeError>()(
  "ElectronThemeError",
  {
    cause: Schema.Defect(),
    themeMode: ThemeModeSchema,
  },
) {
  override get message(): string {
    return `Failed to apply Electron theme mode: ${this.themeMode}.`;
  }
}

export interface ElectronThemeShape {
  readonly setThemeMode: (
    themeMode: ThemeMode,
  ) => Effect.Effect<void, ElectronThemeError>;
  readonly shouldUseDarkColors: Effect.Effect<boolean>;
}

export class ElectronTheme extends Context.Service<
  ElectronTheme,
  ElectronThemeShape
>()("lucent/desktop/electron/ElectronTheme") {}

const setThemeMode: ElectronThemeShape["setThemeMode"] = (themeMode) =>
  Effect.try({
    try: () => {
      nativeTheme.themeSource = themeMode;
    },
    catch: (cause) => new ElectronThemeError({ cause, themeMode }),
  });

const shouldUseDarkColors: ElectronThemeShape["shouldUseDarkColors"] =
  Effect.sync(() => nativeTheme.shouldUseDarkColors);

export const layer = Layer.succeed(
  ElectronTheme,
  ElectronTheme.of({
    setThemeMode,
    shouldUseDarkColors,
  }),
);
