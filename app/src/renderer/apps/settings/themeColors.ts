import { THEME_TOKEN_NAMES, type ThemeTokenName } from "@lucent/core/settings";

export interface ThemeColorRow {
  readonly base: ThemeTokenName;
  readonly foreground?: ThemeTokenName;
  readonly label: string;
}

export const themeTokenLabel = (name: ThemeTokenName): string =>
  name
    .replace(/[A-Z]/g, (match) => ` ${match}`)
    .replace(/^./, (match) => match.toUpperCase());

const isForegroundToken = (name: ThemeTokenName): boolean =>
  name === "foreground" || name.endsWith("Foreground");

const foregroundTokenFor = (
  base: ThemeTokenName,
): ThemeTokenName | undefined => {
  const name = base === "background" ? "foreground" : `${base}Foreground`;
  return THEME_TOKEN_NAMES.find((candidate) => candidate === name);
};

export const THEME_COLOR_ROWS: readonly ThemeColorRow[] =
  THEME_TOKEN_NAMES.filter((name) => !isForegroundToken(name)).map(
    (base): ThemeColorRow => {
      const foreground = foregroundTokenFor(base);
      const label = themeTokenLabel(base);
      return foreground === undefined
        ? { base, label }
        : { base, foreground, label };
    },
  );
