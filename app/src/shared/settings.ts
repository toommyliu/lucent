import { Option, Schema } from "effect";

const APP_SETTINGS_VERSION = 1;

const AppLaunchModeSchema = Schema.Literals(["game", "account-manager"]);
const ThemeModeSchema = Schema.Literals(["system", "light", "dark"]);
const MotionModeSchema = Schema.Literals(["system", "on", "off"]);

export type AppSettingsVersion = typeof APP_SETTINGS_VERSION;

export type AppLaunchMode = typeof AppLaunchModeSchema.Type;
export type ThemeMode = typeof ThemeModeSchema.Type;
export type MotionMode = typeof MotionModeSchema.Type;
export type ThemeVariant = "light" | "dark";
export type ThemeRgb = readonly [number, number, number];

const THEME_TOKEN_NAMES = [
  "background",
  "foreground",
  "card",
  "cardForeground",
  "popover",
  "popoverForeground",
  "primary",
  "primaryForeground",
  "secondary",
  "secondaryForeground",
  "muted",
  "mutedForeground",
  "accent",
  "accentForeground",
  "destructive",
  "destructiveForeground",
  "success",
  "successForeground",
  "warning",
  "warningForeground",
  "info",
  "infoForeground",
  "border",
  "input",
  "ring",
] as const;

const ThemeTokenNameSchema = Schema.Literals(THEME_TOKEN_NAMES);
const ThemeRgbSchema = Schema.Tuple([
  Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 255 })),
  Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 255 })),
  Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 255 })),
]);
const UnknownRecordSchema = Schema.Record(Schema.String, Schema.Unknown);

export type ThemeTokenName = (typeof THEME_TOKEN_NAMES)[number];
export type ThemeTokenValues = Record<ThemeTokenName, ThemeRgb>;

export interface ThemeProfile {
  readonly tokens: Partial<Record<ThemeTokenName, ThemeRgb>>;
  readonly sansFont: string;
  readonly monoFont: string;
  readonly sansFontSize: number;
  readonly monoFontSize: number;
  readonly rounding: number;
}

export interface AppSettings {
  readonly version: AppSettingsVersion;
  readonly preferences: {
    readonly checkForUpdates: boolean;
    readonly launchMode: AppLaunchMode;
  };
  readonly appearance: {
    readonly themeMode: ThemeMode;
    readonly reduceMotion: MotionMode;
    readonly useCursorPointers: boolean;
    readonly themes: Record<ThemeVariant, ThemeProfile>;
  };
}

const DEFAULT_SANS_FONT = '"Inter Variable", sans-serif';
const DEFAULT_MONO_FONT = '"JetBrains Mono Variable", monospace';
const DEFAULT_SANS_FONT_SIZE = 13;
const DEFAULT_MONO_FONT_SIZE = 12;

const DEFAULT_THEME_TOKENS: Record<ThemeVariant, ThemeTokenValues> = {
  light: {
    background: [255, 255, 255],
    foreground: [38, 38, 38],
    card: [255, 255, 255],
    cardForeground: [38, 38, 38],
    popover: [255, 255, 255],
    popoverForeground: [38, 38, 38],
    primary: [38, 38, 38],
    primaryForeground: [250, 250, 250],
    secondary: [245, 245, 245],
    secondaryForeground: [38, 38, 38],
    muted: [245, 245, 245],
    mutedForeground: [92, 92, 92],
    accent: [245, 245, 245],
    accentForeground: [38, 38, 38],
    destructive: [239, 68, 68],
    destructiveForeground: [185, 28, 28],
    success: [16, 185, 129],
    successForeground: [4, 120, 87],
    warning: [245, 158, 11],
    warningForeground: [180, 83, 9],
    info: [59, 130, 246],
    infoForeground: [29, 78, 216],
    border: [235, 235, 235],
    input: [229, 229, 229],
    ring: [163, 163, 163],
  },
  dark: {
    background: [14, 14, 15],
    foreground: [245, 245, 245],
    card: [18, 18, 20],
    cardForeground: [245, 245, 245],
    popover: [22, 22, 24],
    popoverForeground: [245, 245, 245],
    primary: [245, 245, 245],
    primaryForeground: [38, 38, 38],
    secondary: [32, 32, 34],
    secondaryForeground: [245, 245, 245],
    muted: [32, 32, 34],
    mutedForeground: [166, 166, 166],
    accent: [32, 32, 34],
    accentForeground: [245, 245, 245],
    destructive: [248, 113, 113],
    destructiveForeground: [248, 113, 113],
    success: [52, 211, 153],
    successForeground: [52, 211, 153],
    warning: [251, 191, 36],
    warningForeground: [251, 191, 36],
    info: [96, 165, 250],
    infoForeground: [96, 165, 250],
    border: [38, 38, 40],
    input: [46, 46, 49],
    ring: [115, 115, 115],
  },
};

const DEFAULT_LIGHT_THEME_PROFILE: ThemeProfile = {
  tokens: DEFAULT_THEME_TOKENS.light,
  sansFont: DEFAULT_SANS_FONT,
  monoFont: DEFAULT_MONO_FONT,
  sansFontSize: DEFAULT_SANS_FONT_SIZE,
  monoFontSize: DEFAULT_MONO_FONT_SIZE,
  rounding: 1,
};

const DEFAULT_DARK_THEME_PROFILE: ThemeProfile = {
  tokens: DEFAULT_THEME_TOKENS.dark,
  sansFont: DEFAULT_SANS_FONT,
  monoFont: DEFAULT_MONO_FONT,
  sansFontSize: DEFAULT_SANS_FONT_SIZE,
  monoFontSize: DEFAULT_MONO_FONT_SIZE,
  rounding: 1,
};

export const DEFAULT_APP_SETTINGS: AppSettings = {
  version: APP_SETTINGS_VERSION,
  preferences: {
    checkForUpdates: false,
    launchMode: "game",
  },
  appearance: {
    themeMode: "dark",
    reduceMotion: "system",
    useCursorPointers: false,
    themes: {
      light: DEFAULT_LIGHT_THEME_PROFILE,
      dark: DEFAULT_DARK_THEME_PROFILE,
    },
  },
};

const decodeAppLaunchMode = Schema.decodeUnknownOption(AppLaunchModeSchema);
const decodeThemeMode = Schema.decodeUnknownOption(ThemeModeSchema);
const decodeMotionMode = Schema.decodeUnknownOption(MotionModeSchema);
const decodeThemeTokenName = Schema.decodeUnknownOption(ThemeTokenNameSchema);
const decodeThemeRgb = Schema.decodeUnknownOption(ThemeRgbSchema);
const decodeRecord = Schema.decodeUnknownOption(UnknownRecordSchema);
const decodeBoolean = Schema.decodeUnknownOption(Schema.Boolean);
const decodeFinite = Schema.decodeUnknownOption(Schema.Finite);
const decodeString = Schema.decodeUnknownOption(Schema.String);

const decodeOrElse = <A>(
  decode: (value: unknown) => Option.Option<A>,
  value: unknown,
  fallback: A,
): A => {
  const decoded = decode(value);
  return Option.isSome(decoded) ? decoded.value : fallback;
};

const decodeRecordOrEmpty = (value: unknown): Record<string, unknown> => {
  const decoded = decodeRecord(value);
  return Option.isSome(decoded) ? decoded.value : {};
};

export const isAppLaunchMode = (value: unknown): value is AppLaunchMode =>
  Option.isSome(decodeAppLaunchMode(value));

const isThemeTokenName = (value: string): value is ThemeTokenName =>
  Option.isSome(decodeThemeTokenName(value));

const normalizeRgb = (value: unknown): ThemeRgb | undefined => {
  const stringValue = decodeString(value);
  if (Option.isSome(stringValue)) {
    const match = /^#?([0-9a-f]{6})$/i.exec(stringValue.value.trim());
    if (!match) {
      return undefined;
    }

    const hex = match[1];
    if (hex === undefined) {
      return undefined;
    }

    return [
      Number.parseInt(hex.slice(0, 2), 16),
      Number.parseInt(hex.slice(2, 4), 16),
      Number.parseInt(hex.slice(4, 6), 16),
    ];
  }

  const tupleValue = decodeThemeRgb(value);
  return Option.isSome(tupleValue) ? (tupleValue.value as ThemeRgb) : undefined;
};

const rgbToHex = (rgb: ThemeRgb): string =>
  `#${rgb.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;

const normalizeFont = (value: unknown, fallback: string): string => {
  const decoded = decodeString(value);
  if (Option.isNone(decoded)) {
    return fallback;
  }

  const font = decoded.value.trim();
  return font.length > 0 && font.length <= 256 ? font : fallback;
};

const normalizeFontSize = (value: unknown, fallback: number): number => {
  const decoded = decodeFinite(value);
  if (Option.isNone(decoded)) {
    return fallback;
  }

  return Math.min(24, Math.max(10, Math.round(decoded.value)));
};

const normalizeRounding = (value: unknown, fallback: number): number => {
  const decoded = decodeFinite(value);
  if (Option.isNone(decoded)) {
    return fallback;
  }

  return Math.min(2, Math.max(0, decoded.value));
};

const normalizeThemeTokens = (
  value: unknown,
  fallback: Partial<Record<ThemeTokenName, ThemeRgb>>,
): Partial<Record<ThemeTokenName, ThemeRgb>> => {
  const tokenRecord = decodeRecord(value);
  if (Option.isNone(tokenRecord)) {
    return fallback;
  }

  const tokens: Partial<Record<ThemeTokenName, ThemeRgb>> = {};
  for (const [key, rawToken] of Object.entries(tokenRecord.value)) {
    if (!isThemeTokenName(key)) {
      continue;
    }

    const token = normalizeRgb(rawToken);
    if (token !== undefined) {
      tokens[key] = token;
    }
  }

  return { ...fallback, ...tokens };
};

const normalizeThemeProfile = (
  value: unknown,
  fallback: ThemeProfile,
): ThemeProfile => {
  const profile = decodeRecord(value);
  if (Option.isNone(profile)) {
    return fallback;
  }

  return {
    tokens: normalizeThemeTokens(profile.value["tokens"], fallback.tokens),
    sansFont: normalizeFont(profile.value["sansFont"], fallback.sansFont),
    monoFont: normalizeFont(profile.value["monoFont"], fallback.monoFont),
    sansFontSize: normalizeFontSize(
      profile.value["sansFontSize"],
      fallback.sansFontSize,
    ),
    monoFontSize: normalizeFontSize(
      profile.value["monoFontSize"],
      fallback.monoFontSize,
    ),
    rounding: normalizeRounding(profile.value["rounding"], fallback.rounding),
  };
};

export const normalizeAppSettings = (value: unknown): AppSettings => {
  const settings = decodeRecordOrEmpty(value);
  const preferences = decodeRecordOrEmpty(settings["preferences"]);
  const appearance = decodeRecordOrEmpty(settings["appearance"]);
  const themes = decodeRecordOrEmpty(appearance["themes"]);

  return {
    version: APP_SETTINGS_VERSION,
    preferences: {
      checkForUpdates: decodeOrElse(
        decodeBoolean,
        preferences["checkForUpdates"],
        DEFAULT_APP_SETTINGS.preferences.checkForUpdates,
      ),
      launchMode: decodeOrElse(
        decodeAppLaunchMode,
        preferences["launchMode"],
        DEFAULT_APP_SETTINGS.preferences.launchMode,
      ),
    },
    appearance: {
      themeMode: decodeOrElse(
        decodeThemeMode,
        appearance["themeMode"],
        DEFAULT_APP_SETTINGS.appearance.themeMode,
      ),
      reduceMotion: decodeOrElse(
        decodeMotionMode,
        appearance["reduceMotion"],
        DEFAULT_APP_SETTINGS.appearance.reduceMotion,
      ),
      useCursorPointers: decodeOrElse(
        decodeBoolean,
        appearance["useCursorPointers"],
        DEFAULT_APP_SETTINGS.appearance.useCursorPointers,
      ),
      themes: {
        light: normalizeThemeProfile(
          themes["light"],
          DEFAULT_APP_SETTINGS.appearance.themes.light,
        ),
        dark: normalizeThemeProfile(
          themes["dark"],
          DEFAULT_APP_SETTINGS.appearance.themes.dark,
        ),
      },
    },
  };
};

const serializeTokens = (
  tokens: Partial<Record<ThemeTokenName, ThemeRgb>>,
): Partial<Record<ThemeTokenName, string>> => {
  const serialized: Partial<Record<ThemeTokenName, string>> = {};
  for (const [name, value] of Object.entries(tokens)) {
    const tokenName = name as ThemeTokenName;
    const rgb = normalizeRgb(value);
    if (rgb !== undefined) {
      serialized[tokenName] = rgbToHex(rgb);
    }
  }
  return serialized;
};

const serializeThemeProfile = (
  profile: ThemeProfile,
): Omit<ThemeProfile, "tokens"> & {
  readonly tokens: Partial<Record<ThemeTokenName, string>>;
} => ({
  tokens: serializeTokens(profile.tokens),
  sansFont: profile.sansFont,
  monoFont: profile.monoFont,
  sansFontSize: profile.sansFontSize,
  monoFontSize: profile.monoFontSize,
  rounding: profile.rounding,
});

export const serializeAppSettings = (settings: AppSettings): unknown => {
  const normalized = normalizeAppSettings(settings);
  return {
    version: normalized.version,
    preferences: normalized.preferences,
    appearance: {
      themeMode: normalized.appearance.themeMode,
      reduceMotion: normalized.appearance.reduceMotion,
      useCursorPointers: normalized.appearance.useCursorPointers,
      themes: {
        light: serializeThemeProfile(normalized.appearance.themes.light),
        dark: serializeThemeProfile(normalized.appearance.themes.dark),
      },
    },
  };
};
