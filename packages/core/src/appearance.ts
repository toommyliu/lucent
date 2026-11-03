import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import {
  DEFAULT_MONO_FONT,
  DEFAULT_SANS_FONT,
  DEFAULT_THEME_COLORS,
  MotionModeSchema,
  ThemeFontSchema,
  ThemeFontSizeSchema,
  ThemeRoundingSchema,
  ThemeColorsSchema,
  ThemeVariantSchema,
  UnknownRecordSchema,
  normalizeAppSettings,
  type AppSettings,
  type ThemeRgb,
  type ThemeColorName,
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
  colors: ThemeColorsSchema,
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

export const resolveThemeColors = (
  settings: AppSettings,
  variant: ThemeVariant,
): Record<ThemeColorName, ThemeRgb> => ({
  ...DEFAULT_THEME_COLORS[variant],
  ...settings.appearance.themes[variant].colors,
});

const linearizeChannel = (channel: number): number => {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
};

const delinearizeChannel = (value: number): number => {
  const clamped = Math.max(0, Math.min(1, value));
  return (
    255 *
    (clamped <= 0.0031308
      ? clamped * 12.92
      : 1.055 * clamped ** (1 / 2.4) - 0.055)
  );
};

const relativeLuminance = (rgb: ThemeRgb): number =>
  0.2126 * linearizeChannel(rgb[0]) +
  0.7152 * linearizeChannel(rgb[1]) +
  0.0722 * linearizeChannel(rgb[2]);

const contrastRatio = (left: ThemeRgb, right: ThemeRgb): number => {
  const leftLuminance = relativeLuminance(left);
  const rightLuminance = relativeLuminance(right);
  return (
    (Math.max(leftLuminance, rightLuminance) + 0.05) /
    (Math.min(leftLuminance, rightLuminance) + 0.05)
  );
};

type Oklab = readonly [number, number, number];

const toOklab = (rgb: ThemeRgb): Oklab => {
  const r = linearizeChannel(rgb[0]);
  const g = linearizeChannel(rgb[1]);
  const b = linearizeChannel(rgb[2]);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
};

const fromOklab = ([lightness, a, b]: Oklab): ThemeRgb => {
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    delinearizeChannel(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    delinearizeChannel(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    delinearizeChannel(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
};

const mixOklab = (from: ThemeRgb, to: ThemeRgb, amount: number): ThemeRgb => {
  const start = toOklab(from);
  const end = toOklab(to);
  return fromOklab([
    start[0] + (end[0] - start[0]) * amount,
    start[1] + (end[1] - start[1]) * amount,
    start[2] + (end[2] - start[2]) * amount,
  ]);
};

const MINIMUM_TEXT_CONTRAST = 4.5;
const RAISED_SURFACE_TINT = 0.06;
const WHITE: ThemeRgb = [255, 255, 255];
// Mirrors --gray-1 in packages/ui-react/src/styles/tokens.css, the light card surface.
const LIGHT_CARD_WHITE_MIX = 0.67;

export const resolveTextMixFloor = ({
  background,
  foreground,
  variant,
}: {
  readonly background: ThemeRgb;
  readonly foreground: ThemeRgb;
  readonly variant: ThemeVariant;
}): number => {
  const surfaces = [
    mixOklab(background, foreground, RAISED_SURFACE_TINT),
    ...(variant === "light"
      ? [mixOklab(background, WHITE, LIGHT_CARD_WHITE_MIX)]
      : []),
  ];
  let bestPercent = 100;
  let bestContrast = 0;
  for (let percent = 0; percent <= 100; percent += 1) {
    const text = mixOklab(background, foreground, percent / 100);
    const contrast = Math.min(
      ...surfaces.map((surface) => contrastRatio(text, surface)),
    );
    if (contrast >= MINIMUM_TEXT_CONTRAST) {
      return percent;
    }
    if (contrast > bestContrast) {
      bestPercent = percent;
      bestContrast = contrast;
    }
  }
  return bestPercent;
};

const apcaLuminance = (rgb: ThemeRgb): number => {
  const luminance =
    0.2126729 * (rgb[0] / 255) ** 2.4 +
    0.7151522 * (rgb[1] / 255) ** 2.4 +
    0.072175 * (rgb[2] / 255) ** 2.4;
  return luminance < 0.022
    ? // oxlint-disable-next-line oxc/approx-constant -- APCA's black soft-clamp exponent is 1.414, not the square root of 2.
      luminance + (0.022 - luminance) ** 1.414
    : luminance;
};

const apcaContrastMagnitude = (
  text: ThemeRgb,
  background: ThemeRgb,
): number => {
  const textLuminance = apcaLuminance(text);
  const backgroundLuminance = apcaLuminance(background);
  const contrast =
    backgroundLuminance > textLuminance
      ? (backgroundLuminance ** 0.56 - textLuminance ** 0.57) * 1.14
      : (backgroundLuminance ** 0.65 - textLuminance ** 0.62) * 1.14;
  return Math.abs(contrast) < 0.1 ? 0 : Math.abs(contrast) - 0.027;
};

const ON_ACCENT_DARK: ThemeRgb = [25, 25, 28];
const ON_ACCENT_LIGHT: ThemeRgb = [255, 255, 255];

export const pickOnAccentColor = (accent: ThemeRgb): ThemeRgb =>
  apcaContrastMagnitude(ON_ACCENT_LIGHT, accent) >=
  apcaContrastMagnitude(ON_ACCENT_DARK, accent)
    ? ON_ACCENT_LIGHT
    : ON_ACCENT_DARK;

export const createAppearanceSnapshot = (
  settings: AppSettings,
  systemPrefersDark: boolean,
): AppearanceSnapshot => {
  const variant = resolveThemeVariant(settings, systemPrefersDark);
  const profile = settings.appearance.themes[variant];
  const colors = resolveThemeColors(settings, variant);

  return {
    backgroundColor: rgbToHex(colors.background),
    monoFont: profile.monoFont ?? DEFAULT_MONO_FONT,
    monoFontSize: profile.monoFontSize,
    reduceMotion: settings.appearance.reduceMotion,
    rounding: profile.rounding,
    sansFont: profile.sansFont ?? DEFAULT_SANS_FONT,
    sansFontSize: profile.sansFontSize,
    colors: profile.colors,
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
