import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import {
  DEFAULT_APP_SETTINGS,
  MotionModeSchema,
  ThemeFontSchema,
  ThemeFontSizeSchema,
  ThemeRoundingSchema,
  ThemeTokenValuesSchema,
  ThemeVariantSchema,
  UnknownRecordSchema,
  normalizeAppSettings,
  type AppSettings,
  type ThemeRgb,
  type ThemeTokenValues,
  type ThemeVariant,
} from "./settings";

export const AppearanceSnapshotSchema = Schema.Struct({
  backgroundColor: Schema.String,
  monoFont: ThemeFontSchema,
  monoFontSize: ThemeFontSizeSchema,
  reduceMotion: MotionModeSchema,
  rounding: ThemeRoundingSchema,
  sansFont: ThemeFontSchema,
  sansFontSize: ThemeFontSizeSchema,
  tokens: ThemeTokenValuesSchema,
  useCursorPointers: Schema.Boolean,
  variant: ThemeVariantSchema,
});

export type AppearanceSnapshot = typeof AppearanceSnapshotSchema.Type;

export const APPEARANCE_SNAPSHOT_ARGUMENT = "--lucent__appearance";
export const SETTINGS_SNAPSHOT_ARGUMENT = "--lucent__settings";

const decodeAppearanceSnapshot = Schema.decodeUnknownOption(
  AppearanceSnapshotSchema,
);
const decodeUnknownRecord = Schema.decodeUnknownOption(UnknownRecordSchema);

const textSizeRatios = {
  "--text-2xs": 10 / 14,
  "--text-xs": 11 / 14,
  "--text-sm": 12 / 14,
  "--text-base": 1,
  "--text-md": 14 / 14,
  "--text-lg": 15 / 14,
  "--text-xl": 16 / 14,
  "--text-2xl": 18 / 14,
  "--text-3xl": 20 / 14,
  "--text-4xl": 24 / 14,
  "--text-5xl": 28 / 14,
} as const;

type TextSizeTokenName = keyof typeof textSizeRatios;

const HEX_RGB_PATTERN = /^#?([0-9a-f]{6})$/i;

const toHexPair = (value: number): string =>
  Math.max(0, Math.min(255, value)).toString(16).padStart(2, "0");

export const rgbEquals = (left: ThemeRgb, right: ThemeRgb): boolean =>
  left[0] === right[0] && left[1] === right[1] && left[2] === right[2];

export const rgbToCssValue = (rgb: ThemeRgb): string => rgb.join(", ");

export const rgbToHex = (rgb: ThemeRgb): string =>
  `#${toHexPair(rgb[0])}${toHexPair(rgb[1])}${toHexPair(rgb[2])}`;

export const hexToRgb = (hex: string): ThemeRgb | null => {
  const match = HEX_RGB_PATTERN.exec(hex.trim());
  const value = match?.[1];
  if (value === undefined) {
    return null;
  }

  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ];
};

export const getTextSizeTokens = (
  baseSize: number,
): Record<TextSizeTokenName, string> => {
  const tokens = {} as Record<TextSizeTokenName, string>;
  for (const [name, ratio] of Object.entries(textSizeRatios) as Array<
    [TextSizeTokenName, number]
  >) {
    tokens[name] = `${Number((baseSize * ratio).toFixed(4))}px`;
  }
  return tokens;
};

export const resolveThemeVariant = (
  settings: AppSettings,
  systemPrefersDark: boolean,
): ThemeVariant => {
  const mode = settings.appearance.themeMode;
  if (mode === "light" || mode === "dark") {
    return mode;
  }
  return systemPrefersDark ? "dark" : "light";
};

export const resolveThemeTokens = (
  settings: AppSettings,
  variant: ThemeVariant,
): ThemeTokenValues => ({
  ...DEFAULT_APP_SETTINGS.appearance.themes[variant].tokens,
  ...settings.appearance.themes[variant].tokens,
});

export const createAppearanceSnapshot = (
  settings: AppSettings,
  systemPrefersDark: boolean,
): AppearanceSnapshot => {
  const variant = resolveThemeVariant(settings, systemPrefersDark);
  const profile = settings.appearance.themes[variant];
  const tokens = resolveThemeTokens(settings, variant);

  return {
    backgroundColor: rgbToHex(tokens.background),
    monoFont: profile.monoFont,
    monoFontSize: profile.monoFontSize,
    reduceMotion: settings.appearance.reduceMotion,
    rounding: profile.rounding,
    sansFont: profile.sansFont,
    sansFontSize: profile.sansFontSize,
    tokens,
    useCursorPointers: settings.appearance.useCursorPointers,
    variant,
  };
};

const parseSerializedJson = (value: string): unknown | null => {
  try {
    return JSON.parse(decodeURIComponent(value));
  } catch {
    return null;
  }
};

const readArgumentValue = (
  argv: readonly string[],
  name: string,
): string | null => {
  const prefix = `${name}=`;
  const value = argv.find((argument) => argument.startsWith(prefix));
  return value === undefined ? null : value.slice(prefix.length);
};

export const serializeAppearanceSnapshotArgument = (
  snapshot: AppearanceSnapshot,
): string =>
  `${APPEARANCE_SNAPSHOT_ARGUMENT}=${encodeURIComponent(
    JSON.stringify(snapshot),
  )}`;

export const readAppearanceSnapshotArgument = (
  argv: readonly string[],
): AppearanceSnapshot | null => {
  const value = readArgumentValue(argv, APPEARANCE_SNAPSHOT_ARGUMENT);
  if (value === null) {
    return null;
  }

  const parsed = parseSerializedJson(value);
  if (parsed === null) {
    return null;
  }

  const decoded = decodeAppearanceSnapshot(parsed);
  return Option.isSome(decoded) ? decoded.value : null;
};

export const serializeSettingsSnapshotArgument = (
  settings: AppSettings,
): string =>
  `${SETTINGS_SNAPSHOT_ARGUMENT}=${encodeURIComponent(JSON.stringify(settings))}`;

export const readSettingsSnapshotArgument = (
  argv: readonly string[],
): AppSettings | null => {
  const value = readArgumentValue(argv, SETTINGS_SNAPSHOT_ARGUMENT);
  if (value === null) {
    return null;
  }

  const parsed = parseSerializedJson(value);
  if (parsed === null) {
    return null;
  }

  const decoded = decodeUnknownRecord(parsed);
  return Option.isSome(decoded) ? normalizeAppSettings(decoded.value) : null;
};
