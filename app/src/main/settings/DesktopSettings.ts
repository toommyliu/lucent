import { Context, Effect, Layer, Schema, SynchronizedRef } from "effect";

import {
  DEFAULT_APP_SETTINGS,
  normalizeAppSettings,
  serializeAppSettings,
  type AppearancePatch,
  type AppSettings,
  type PreferencesPatch,
  type ThemeProfile,
  type ThemeProfilePatch,
  type ThemeRgb,
  type ThemeTokenName,
  type ThemeVariant,
} from "../../shared/settings";
import {
  DEFAULT_HOTKEYS,
  SETTINGS_COMMANDS,
  findDuplicateHotkeyBinding,
  getSettingsCommandDefinition,
  isSettingsCommandId,
  normalizeHotkeyBindingValue,
  type HotkeyBinding,
  type HotkeysPatch,
  type SettingsCommandId,
} from "../../shared/hotkeys";
import { DesktopEnvironment } from "../app/DesktopEnvironment";
import { type JsonFileError, readJsonFile, writeJsonFile } from "./JsonFile";

const settingsOperationSchema = Schema.Literals([
  "mkdir",
  "parse",
  "read",
  "rename",
  "unlink",
  "write",
  "validate-hotkey",
]);

export class DesktopSettingsError extends Schema.TaggedErrorClass<DesktopSettingsError>()(
  "DesktopSettingsError",
  {
    detail: Schema.String,
    operation: settingsOperationSchema,
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {
  override get message(): string {
    return this.detail;
  }
}

export interface DesktopSettingsShape {
  readonly get: Effect.Effect<AppSettings, DesktopSettingsError>;
  readonly load: Effect.Effect<AppSettings, DesktopSettingsError>;
  readonly onChanged: (
    listener: (settings: AppSettings) => void,
  ) => Effect.Effect<() => void>;
  readonly resetAppearance: Effect.Effect<AppSettings, DesktopSettingsError>;
  readonly resetHotkeys: Effect.Effect<AppSettings, DesktopSettingsError>;
  readonly updateAppearance: (
    patch: AppearancePatch,
  ) => Effect.Effect<AppSettings, DesktopSettingsError>;
  readonly updateHotkeys: (
    patch: HotkeysPatch,
  ) => Effect.Effect<AppSettings, DesktopSettingsError>;
  readonly updatePreferences: (
    patch: PreferencesPatch,
  ) => Effect.Effect<AppSettings, DesktopSettingsError>;
}

export class DesktopSettings extends Context.Service<
  DesktopSettings,
  DesktopSettingsShape
>()("lucent/desktop/settings/DesktopSettings") {}

const wrapDataError = (error: JsonFileError): DesktopSettingsError =>
  new DesktopSettingsError({
    operation: error.operation,
    detail: error.message,
    cause: error,
  });

const normalizeThemeTokenPatch = (
  value: ThemeRgb | null,
  fallback: ThemeRgb,
): ThemeRgb => value ?? fallback;

const mergeThemeProfile = (
  variant: ThemeVariant,
  current: ThemeProfile,
  patch: ThemeProfilePatch,
): ThemeProfile => {
  const defaults = DEFAULT_APP_SETTINGS.appearance.themes[variant];
  const tokens: Record<ThemeTokenName, ThemeRgb> = {
    ...current.tokens,
  };

  if (patch.tokens !== undefined) {
    for (const [name, value] of Object.entries(patch.tokens)) {
      const tokenName = name as ThemeTokenName;
      tokens[tokenName] = normalizeThemeTokenPatch(
        value,
        defaults.tokens[tokenName],
      );
    }
  }

  return {
    tokens,
    sansFont: patch.sansFont ?? current.sansFont,
    monoFont: patch.monoFont ?? current.monoFont,
    sansFontSize: patch.sansFontSize ?? current.sansFontSize,
    monoFontSize: patch.monoFontSize ?? current.monoFontSize,
    rounding: patch.rounding ?? current.rounding,
  };
};

const applyAppearancePatch = (
  current: AppSettings,
  patch: AppearancePatch,
): AppSettings => {
  const themes = { ...current.appearance.themes };
  if (patch.themes !== undefined) {
    for (const [variant, profilePatch] of Object.entries(patch.themes)) {
      if (variant !== "light" && variant !== "dark") {
        continue;
      }
      themes[variant] = mergeThemeProfile(
        variant,
        current.appearance.themes[variant],
        profilePatch,
      );
    }
  }

  return normalizeAppSettings({
    ...current,
    appearance: {
      ...current.appearance,
      themeMode: patch.themeMode ?? current.appearance.themeMode,
      reduceMotion: patch.reduceMotion ?? current.appearance.reduceMotion,
      useCursorPointers:
        patch.useCursorPointers ?? current.appearance.useCursorPointers,
      themes,
    },
  });
};

const applyPreferencesPatch = (
  current: AppSettings,
  patch: PreferencesPatch,
): AppSettings =>
  normalizeAppSettings({
    ...current,
    preferences: {
      ...current.preferences,
      checkForUpdates:
        patch.checkForUpdates ?? current.preferences.checkForUpdates,
      launchMode: patch.launchMode ?? current.preferences.launchMode,
    },
  });

const hotkeyValidationError = (detail: string): DesktopSettingsError =>
  new DesktopSettingsError({
    operation: "validate-hotkey",
    detail,
  });

const createHotkeyBindingMap = (
  settings: AppSettings,
): Map<SettingsCommandId, string> =>
  new Map(
    settings.hotkeys.bindings.map((binding) => [binding.id, binding.value]),
  );

const createOrderedHotkeyBindings = (
  values: ReadonlyMap<SettingsCommandId, string>,
): readonly HotkeyBinding[] =>
  SETTINGS_COMMANDS.map((command) => ({
    id: command.id,
    value: values.get(command.id) ?? command.defaultHotkey,
  }));

const applyHotkeysPatch = (
  current: AppSettings,
  patch: HotkeysPatch,
): Effect.Effect<AppSettings, DesktopSettingsError> =>
  Effect.gen(function* () {
    const values = createHotkeyBindingMap(current);
    for (const binding of patch.bindings ?? []) {
      if (!isSettingsCommandId(binding.id)) {
        return yield* hotkeyValidationError(
          `Unknown hotkey command: ${String(binding.id)}`,
        );
      }

      const nextValue =
        binding.value === null
          ? getSettingsCommandDefinition(binding.id).defaultHotkey
          : normalizeHotkeyBindingValue(binding.value);
      if (nextValue === null) {
        return yield* hotkeyValidationError(
          `Invalid hotkey binding for ${
            getSettingsCommandDefinition(binding.id).label
          }.`,
        );
      }
      values.set(binding.id, nextValue);
    }

    const bindings = createOrderedHotkeyBindings(values);
    const duplicate = findDuplicateHotkeyBinding(bindings);
    if (duplicate !== null) {
      return yield* hotkeyValidationError(
        `Hotkey is already assigned to ${
          getSettingsCommandDefinition(duplicate.id).label
        }.`,
      );
    }

    return normalizeAppSettings({
      ...current,
      hotkeys: { bindings },
    });
  });

const makeDesktopSettings = Effect.gen(function* () {
  const env = yield* DesktopEnvironment;
  const settingsRef = yield* SynchronizedRef.make<AppSettings | null>(null);
  const listeners = new Set<(settings: AppSettings) => void>();

  const readSettingsFromFile = Effect.gen(function* () {
    const result = yield* readJsonFile(env.settingsPath).pipe(
      Effect.mapError(wrapDataError),
    );
    if (result.status === "missing") {
      yield* writeJsonFile(
        env.settingsPath,
        serializeAppSettings(DEFAULT_APP_SETTINGS),
      ).pipe(Effect.mapError(wrapDataError));
      return DEFAULT_APP_SETTINGS;
    }

    const settings = normalizeAppSettings(result.value);
    yield* writeJsonFile(env.settingsPath, serializeAppSettings(settings)).pipe(
      Effect.mapError(wrapDataError),
    );
    return settings;
  });

  const loadSettings = SynchronizedRef.modifyEffect(settingsRef, () =>
    readSettingsFromFile.pipe(
      Effect.map((settings) => [settings, settings] as const),
    ),
  );

  const getSettings = SynchronizedRef.get(settingsRef).pipe(
    Effect.flatMap((current) =>
      current === null ? loadSettings : Effect.succeed(current),
    ),
  );

  const writeSettingsFile = (
    settings: AppSettings,
  ): Effect.Effect<AppSettings, DesktopSettingsError> => {
    const normalized = normalizeAppSettings(settings);
    return writeJsonFile(
      env.settingsPath,
      serializeAppSettings(normalized),
    ).pipe(Effect.mapError(wrapDataError), Effect.as(normalized));
  };

  const publish = (settings: AppSettings): Effect.Effect<void> =>
    Effect.sync(() => {
      for (const listener of listeners) {
        listener(settings);
      }
    });

  const update = (
    modify: (
      current: AppSettings,
    ) => Effect.Effect<AppSettings, DesktopSettingsError>,
  ): Effect.Effect<AppSettings, DesktopSettingsError> =>
    SynchronizedRef.modifyEffect(settingsRef, (current) =>
      (current === null ? readSettingsFromFile : Effect.succeed(current)).pipe(
        Effect.flatMap(modify),
        Effect.flatMap(writeSettingsFile),
        Effect.map((saved) => [saved, saved] as const),
      ),
    ).pipe(Effect.tap(publish));

  return DesktopSettings.of({
    get: getSettings,
    load: loadSettings,
    onChanged: (listener) =>
      Effect.sync(() => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      }),
    resetAppearance: update((current) =>
      Effect.succeed(
        normalizeAppSettings({
          ...current,
          appearance: DEFAULT_APP_SETTINGS.appearance,
        }),
      ),
    ),
    resetHotkeys: update((current) =>
      Effect.succeed(
        normalizeAppSettings({
          ...current,
          hotkeys: DEFAULT_HOTKEYS,
        }),
      ),
    ),
    updateAppearance: (patch) =>
      update((current) => Effect.succeed(applyAppearancePatch(current, patch))),
    updateHotkeys: (patch) =>
      update((current) => applyHotkeysPatch(current, patch)),
    updatePreferences: (patch) =>
      update((current) =>
        Effect.succeed(applyPreferencesPatch(current, patch)),
      ),
  });
});

export const layer = Layer.effect(DesktopSettings, makeDesktopSettings);
