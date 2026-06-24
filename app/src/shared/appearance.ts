import { Option, Schema } from "effect";

import {
  DEFAULT_APP_SETTINGS,
  MotionModeSchema,
  THEME_TOKEN_NAMES,
  ThemeFontSchema,
  ThemeFontSizeSchema,
  ThemeRoundingSchema,
  ThemeTokenValuesSchema,
  ThemeVariantSchema,
  UnknownRecordSchema,
  normalizeAppSettings,
  type AppSettings,
  type ThemeRgb,
  type ThemeTokenName,
  type ThemeTokenValues,
  type ThemeVariant,
} from "./settings";
import type { DesktopBridgeView } from "./desktopBridge";

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
export const DESKTOP_VIEW_ARGUMENT = "--lucent__view";

const tokenCssNames = new Map<ThemeTokenName, string>(
  THEME_TOKEN_NAMES.map((name) => [
    name,
    `--${name.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)}`,
  ]),
);

const radiusBaseRem = {
  "--radius": 0.625,
  "--radius-xs": 0.25,
  "--radius-sm": 0.375,
  "--radius-md": 0.5,
  "--radius-lg": 0.5,
  "--radius-xl": 0.75,
} as const;

const textSizeRatios = {
  "--text-2xs": 10 / 13,
  "--text-xs": 11 / 13,
  "--text-sm": 12 / 13,
  "--text-base": 1,
  "--text-md": 14 / 13,
  "--text-lg": 15 / 13,
  "--text-xl": 16 / 13,
  "--text-2xl": 18 / 13,
  "--text-3xl": 20 / 13,
  "--text-4xl": 24 / 13,
  "--text-5xl": 28 / 13,
} as const;

type RadiusTokenName = keyof typeof radiusBaseRem;
type TextSizeTokenName = keyof typeof textSizeRatios;

const toHexPair = (value: number): string =>
  Math.max(0, Math.min(255, value)).toString(16).padStart(2, "0");

export const rgbToCssValue = (rgb: ThemeRgb): string => rgb.join(", ");

export const rgbToHex = (rgb: ThemeRgb): string =>
  `#${toHexPair(rgb[0])}${toHexPair(rgb[1])}${toHexPair(rgb[2])}`;

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

  const decoded = Schema.decodeUnknownOption(AppearanceSnapshotSchema)(parsed);
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

  const decoded = Schema.decodeUnknownOption(UnknownRecordSchema)(parsed);
  return Option.isSome(decoded) ? normalizeAppSettings(decoded.value) : null;
};

const DesktopBridgeViewSchema = Schema.Literals(["game", "settings"]);

export const serializeDesktopViewArgument = (view: DesktopBridgeView): string =>
  `${DESKTOP_VIEW_ARGUMENT}=${view}`;

export const readDesktopViewArgument = (
  argv: readonly string[],
): DesktopBridgeView | null => {
  const value = readArgumentValue(argv, DESKTOP_VIEW_ARGUMENT);
  const decoded = Schema.decodeUnknownOption(DesktopBridgeViewSchema)(value);
  return Option.isSome(decoded) ? decoded.value : null;
};

const applyRounding = (
  style: CSSStyleDeclaration,
  multiplier: number,
): void => {
  for (const [name, base] of Object.entries(radiusBaseRem) as Array<
    [RadiusTokenName, number]
  >) {
    style.setProperty(name, `${base * multiplier}rem`);
  }
};

const applyTypography = (
  style: CSSStyleDeclaration,
  snapshot: AppearanceSnapshot,
): void => {
  style.setProperty("--font-sans", snapshot.sansFont);
  style.setProperty("--font-mono", snapshot.monoFont);
  style.setProperty("--font-mono-size", `${snapshot.monoFontSize}px`);

  for (const [name, value] of Object.entries(
    getTextSizeTokens(snapshot.sansFontSize),
  ) as Array<[TextSizeTokenName, string]>) {
    style.setProperty(name, value);
  }
};

export const applyAppearanceSnapshotToDocument = (
  root: HTMLElement,
  snapshot: AppearanceSnapshot,
): void => {
  const style = root.style;

  root.dataset["theme"] = snapshot.variant;
  root.dataset["reduceMotion"] = snapshot.reduceMotion;
  root.classList.toggle("dark", snapshot.variant === "dark");
  if (snapshot.useCursorPointers) {
    root.dataset["useCursorPointers"] = "true";
  } else {
    delete root.dataset["useCursorPointers"];
  }

  style.setProperty("color-scheme", snapshot.variant);
  style.setProperty(
    "--cursor-interactive",
    snapshot.useCursorPointers ? "pointer" : "default",
  );

  for (const name of THEME_TOKEN_NAMES) {
    const cssName = tokenCssNames.get(name);
    if (cssName !== undefined) {
      style.setProperty(cssName, rgbToCssValue(snapshot.tokens[name]));
    }
  }

  applyTypography(style, snapshot);
  applyRounding(style, snapshot.rounding);
};
