import { isGameCommandId } from "./commands";
import {
  THEME_TOKEN_NAMES,
  isMotionMode,
  type AppSettings,
  type ThemeMode,
  type ThemeRgb,
  type ThemeTokenName,
} from "./settings";

export const SETTINGS_SNAPSHOT_ARGUMENT = "--settings-snapshot";

const themeTokenNames = new Set<string>(THEME_TOKEN_NAMES);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isThemeMode = (value: unknown): value is ThemeMode =>
  value === "light" || value === "dark" || value === "system";

const isThemeRgb = (value: unknown): value is ThemeRgb => {
  if (!Array.isArray(value) || value.length !== 3) {
    return false;
  }

  return value.every(
    (channel) => Number.isInteger(channel) && channel >= 0 && channel <= 255,
  );
};

const isThemeTokens = (
  value: unknown,
): value is Partial<Record<ThemeTokenName, ThemeRgb>> => {
  if (!isRecord(value)) {
    return false;
  }

  for (const [name, token] of Object.entries(value)) {
    if (!themeTokenNames.has(name) || !isThemeRgb(token)) {
      return false;
    }
  }

  return true;
};

const isThemeProfile = (value: unknown): boolean =>
  isRecord(value) &&
  isThemeTokens(value["tokens"]) &&
  typeof value["sansFont"] === "string" &&
  typeof value["monoFont"] === "string" &&
  typeof value["sansFontSize"] === "number" &&
  Number.isFinite(value["sansFontSize"]) &&
  typeof value["monoFontSize"] === "number" &&
  Number.isFinite(value["monoFontSize"]) &&
  typeof value["rounding"] === "number" &&
  Number.isFinite(value["rounding"]);

const isAppearance = (value: unknown): boolean => {
  if (!isRecord(value) || !isRecord(value["themes"])) {
    return false;
  }

  const themes = value["themes"];
  return (
    isThemeMode(value["themeMode"]) &&
    isMotionMode(value["reduceMotion"]) &&
    typeof value["useCursorPointers"] === "boolean" &&
    isThemeProfile(themes["light"]) &&
    isThemeProfile(themes["dark"])
  );
};

const isPreferences = (value: unknown): boolean =>
  isRecord(value) &&
  typeof value["checkForUpdates"] === "boolean" &&
  (value["launchMode"] === "game" || value["launchMode"] === "account-manager");

const isHotkeys = (value: unknown): boolean =>
  isRecord(value) &&
  Array.isArray(value["bindings"]) &&
  value["bindings"].every(
    (binding) =>
      isRecord(binding) &&
      isGameCommandId(binding["id"]) &&
      typeof binding["value"] === "string",
  );

export const isAppSettingsSnapshot = (value: unknown): value is AppSettings =>
  isRecord(value) &&
  isPreferences(value["preferences"]) &&
  isAppearance(value["appearance"]) &&
  isHotkeys(value["hotkeys"]);

export const serializeSettingsSnapshotArgument = (
  settings: AppSettings,
): string =>
  `${SETTINGS_SNAPSHOT_ARGUMENT}=${encodeURIComponent(
    JSON.stringify(settings),
  )}`;

export const readSettingsSnapshotArgument = (
  argv: readonly string[],
): AppSettings | null => {
  const prefix = `${SETTINGS_SNAPSHOT_ARGUMENT}=`;
  const raw = argv.find((arg) => arg.startsWith(prefix));
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(decodeURIComponent(raw.slice(prefix.length)));
    return isAppSettingsSnapshot(parsed) ? parsed : null;
  } catch {
    return null;
  }
};
