import { BrowserWindow, nativeTheme } from "electron";
import { Effect, Layer, ServiceMap, SynchronizedRef } from "effect";
import { SettingsIpcChannels } from "../../shared/ipc";
import {
  THEME_TOKEN_NAMES,
  isMotionMode,
  type AppSettings,
  type Appearance,
  type AppearancePatch,
  type HotkeysPatch,
  type Preferences,
  type PreferencesPatch,
  type ThemeMode,
  type ThemeProfile,
  type ThemeProfilePatch,
  type ThemeRgb,
  type ThemeTokenName,
  type ThemeVariant,
} from "../../shared/settings";
import { DesktopEnvironment } from "../app/DesktopEnvironment";
import { DesktopObservability } from "../app/DesktopObservability";
import {
  DesktopStorage,
  type DesktopStorageError,
} from "../storage/DesktopStorage";
import * as AppearanceSettings from "./Appearance";
import * as HotkeysSettings from "./Hotkeys";
import * as PreferencesSettings from "./Preferences";

type SettingsChangeListener = (settings: AppSettings) => void;

export interface DesktopSettingsShape {
  readonly load: Effect.Effect<AppSettings, DesktopStorageError>;
  readonly get: Effect.Effect<AppSettings, DesktopStorageError>;
  readonly updatePreferences: (
    patch: PreferencesPatch,
  ) => Effect.Effect<AppSettings, DesktopStorageError>;
  readonly updateAppearance: (
    patch: AppearancePatch,
  ) => Effect.Effect<AppSettings, DesktopStorageError>;
  readonly updateHotkeys: (
    patch: HotkeysPatch,
  ) => Effect.Effect<AppSettings, DesktopStorageError>;
  readonly resetAppearance: Effect.Effect<AppSettings, DesktopStorageError>;
  readonly resetHotkeys: Effect.Effect<AppSettings, DesktopStorageError>;
  readonly onChanged: (
    listener: SettingsChangeListener,
  ) => Effect.Effect<() => void>;
  readonly syncNativeTheme: (appearance: Appearance) => Effect.Effect<void>;
  readonly installNativeThemeChangeBroadcast: Effect.Effect<void>;
}

export class DesktopSettings extends ServiceMap.Service<
  DesktopSettings,
  DesktopSettingsShape
>()("main/DesktopSettings") {}

const themeTokenNames = new Set<string>(THEME_TOKEN_NAMES);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isThemeMode = (value: unknown): value is ThemeMode =>
  value === "light" || value === "dark" || value === "system";

const isThemeVariant = (value: string): value is ThemeVariant =>
  value === "light" || value === "dark";

const isThemeTokenName = (value: string): value is ThemeTokenName =>
  themeTokenNames.has(value);

const applyThemeProfilePatch = (
  profile: ThemeProfile,
  patch: ThemeProfilePatch,
): ThemeProfile => {
  const tokens: Partial<Record<ThemeTokenName, ThemeRgb>> = {
    ...profile.tokens,
  };

  if (isRecord(patch.tokens)) {
    for (const [name, rawValue] of Object.entries(patch.tokens)) {
      if (!isThemeTokenName(name)) {
        continue;
      }

      if (rawValue === null) {
        delete tokens[name];
        continue;
      }

      const value = AppearanceSettings.normalizeRgb(rawValue);
      if (value !== undefined) {
        tokens[name] = value;
      }
    }
  }

  return {
    tokens,
    sansFont:
      AppearanceSettings.normalizeFont(patch.sansFont) ?? profile.sansFont,
    monoFont:
      AppearanceSettings.normalizeFont(patch.monoFont) ?? profile.monoFont,
    sansFontSize:
      AppearanceSettings.normalizeFontSize(patch.sansFontSize) ??
      profile.sansFontSize,
    monoFontSize:
      AppearanceSettings.normalizeFontSize(patch.monoFontSize) ??
      profile.monoFontSize,
    rounding:
      AppearanceSettings.normalizeRounding(patch.rounding) ?? profile.rounding,
  };
};

export const DesktopSettingsLive = Layer.effect(DesktopSettings)(
  Effect.gen(function* () {
    const env = yield* DesktopEnvironment;
    const storage = yield* DesktopStorage;
    const observability = yield* DesktopObservability;
    const listeners = new Set<SettingsChangeListener>();
    let nativeThemeListenerInstalled = false;

    const preferencesPath = env.appDataPath(PreferencesSettings.fileName);
    const appearancePath = env.appDataPath(AppearanceSettings.fileName);
    const hotkeysPath = env.appDataPath(HotkeysSettings.fileName);

    const makeSettingsFile = <A>(options: {
      readonly path: string;
      readonly label: string;
      readonly defaults: A;
      readonly normalize: (value: unknown) => A;
      readonly serialize: (value: A) => unknown;
    }) =>
      storage.makeJsonFile<A>({
        path: options.path,
        defaults: () => options.defaults,
        normalize: options.normalize,
        serialize: options.serialize,
        onMalformed: ({ path, quarantinePath, error }) =>
          observability
            .warn("settings", "Malformed settings file", {
              label: options.label,
              path,
              quarantinePath,
              error,
            })
            .pipe(Effect.asVoid),
      });

    const preferencesFile = yield* makeSettingsFile({
      path: preferencesPath,
      label: "preferences",
      defaults: PreferencesSettings.DEFAULT,
      normalize: PreferencesSettings.normalize,
      serialize: PreferencesSettings.serialize,
    });
    const appearanceFile = yield* makeSettingsFile({
      path: appearancePath,
      label: "appearance",
      defaults: AppearanceSettings.DEFAULT,
      normalize: AppearanceSettings.normalize,
      serialize: AppearanceSettings.serialize,
    });
    const hotkeysFile = yield* makeSettingsFile({
      path: hotkeysPath,
      label: "hotkeys",
      defaults: HotkeysSettings.DEFAULT,
      normalize: HotkeysSettings.normalize,
      serialize: HotkeysSettings.serialize,
    });

    const loadSettings = Effect.gen(function* () {
      const preferences = yield* preferencesFile.get;
      const appearance = yield* appearanceFile.get;
      const hotkeys = yield* hotkeysFile.get;

      return { preferences, appearance, hotkeys } satisfies AppSettings;
    });

    const stateRef = yield* SynchronizedRef.make<AppSettings | null>(null);

    const syncNativeTheme = (appearance: Appearance) =>
      Effect.sync(() => {
        nativeTheme.themeSource = appearance.themeMode;
      });

    const broadcastSettings = (settings: AppSettings): void => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (win.isDestroyed() || win.webContents.isDestroyed()) {
          continue;
        }

        win.webContents.send(SettingsIpcChannels.changed, settings);
      }
    };

    const publishSettings = (
      settings: AppSettings,
    ): Effect.Effect<AppSettings> =>
      Effect.gen(function* () {
        yield* syncNativeTheme(settings.appearance);
        yield* Effect.sync(() => {
          broadcastSettings(settings);
          for (const listener of listeners) {
            listener(settings);
          }
        });
        return settings;
      });

    const get = SynchronizedRef.get(stateRef).pipe(
      Effect.flatMap((current) =>
        current === null
          ? loadSettings.pipe(
              Effect.tap((settings) => SynchronizedRef.set(stateRef, settings)),
            )
          : Effect.succeed(current),
      ),
    );

    const modifySettings = (
      update: (
        current: AppSettings,
      ) => Effect.Effect<AppSettings, DesktopStorageError>,
    ) =>
      SynchronizedRef.modifyEffect(stateRef, (current) =>
        Effect.gen(function* () {
          const base = current ?? (yield* loadSettings);
          const next = yield* update(base);
          return [next, next] as const;
        }),
      ).pipe(Effect.flatMap((settings) => publishSettings(settings)));

    const updatePreferences = (patch: PreferencesPatch) =>
      modifySettings((current) => {
        const nextPreferences: Preferences = {
          checkForUpdates:
            typeof patch.checkForUpdates === "boolean"
              ? patch.checkForUpdates
              : current.preferences.checkForUpdates,
          launchMode: PreferencesSettings.isLaunchMode(patch.launchMode)
            ? patch.launchMode
            : current.preferences.launchMode,
        };

        return preferencesFile.set(nextPreferences).pipe(
          Effect.as({
            ...current,
            preferences: nextPreferences,
          }),
        );
      });

    const updateAppearance = (patch: AppearancePatch) =>
      modifySettings((current) => {
        let light = current.appearance.themes.light;
        let dark = current.appearance.themes.dark;

        if (isRecord(patch.themes)) {
          for (const [variant, profilePatch] of Object.entries(patch.themes)) {
            if (!isThemeVariant(variant) || !isRecord(profilePatch)) {
              continue;
            }

            if (variant === "light") {
              light = applyThemeProfilePatch(light, profilePatch);
            } else {
              dark = applyThemeProfilePatch(dark, profilePatch);
            }
          }
        }

        const nextAppearance: Appearance = {
          themeMode: isThemeMode(patch.themeMode)
            ? patch.themeMode
            : current.appearance.themeMode,
          reduceMotion: isMotionMode(patch.reduceMotion)
            ? patch.reduceMotion
            : current.appearance.reduceMotion,
          useCursorPointers:
            typeof patch.useCursorPointers === "boolean"
              ? patch.useCursorPointers
              : current.appearance.useCursorPointers,
          themes: { light, dark },
        };

        return appearanceFile.set(nextAppearance).pipe(
          Effect.as({
            ...current,
            appearance: AppearanceSettings.normalize(nextAppearance),
          }),
        );
      });

    const updateHotkeys = (patch: HotkeysPatch) =>
      modifySettings((current) => {
        const nextHotkeys = Array.isArray(patch.bindings)
          ? HotkeysSettings.applyPatch(current.hotkeys, patch.bindings)
          : current.hotkeys;

        return hotkeysFile.set(nextHotkeys).pipe(
          Effect.as({
            ...current,
            hotkeys: nextHotkeys,
          }),
        );
      });

    const resetAppearance = modifySettings((current) =>
      appearanceFile.set(AppearanceSettings.DEFAULT).pipe(
        Effect.as({
          ...current,
          appearance: AppearanceSettings.DEFAULT,
        }),
      ),
    );

    const resetHotkeys = modifySettings((current) =>
      hotkeysFile.set(HotkeysSettings.DEFAULT).pipe(
        Effect.as({
          ...current,
          hotkeys: HotkeysSettings.DEFAULT,
        }),
      ),
    );

    return {
      load: loadSettings.pipe(
        Effect.tap((settings) => SynchronizedRef.set(stateRef, settings)),
        Effect.tap((settings) => syncNativeTheme(settings.appearance)),
      ),
      get,
      updatePreferences,
      updateAppearance,
      updateHotkeys,
      resetAppearance,
      resetHotkeys,
      onChanged: (listener) =>
        Effect.sync(() => {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        }),
      syncNativeTheme,
      installNativeThemeChangeBroadcast: Effect.sync(() => {
        if (nativeThemeListenerInstalled) {
          return;
        }

        nativeThemeListenerInstalled = true;
        nativeTheme.on("updated", () => {
          void Effect.runPromise(
            get.pipe(
              Effect.map((settings) => {
                broadcastSettings(settings);
              }),
            ),
          );
        });
      }),
    };
  }),
);
