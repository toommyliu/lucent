import {
  DocsContainer,
  type DocsContainerProps,
} from "@storybook/addon-docs/blocks";
import { useEffect, useState, type PropsWithChildren } from "react";
import { GLOBALS_UPDATED } from "storybook/internal/core-events";
import { themes } from "storybook/theming";

export type ThemeName = "dark" | "light";

export const defaultTheme: ThemeName = "dark";

function isThemeName(value: unknown): value is ThemeName {
  return value === "dark" || value === "light";
}

function readTheme(context: object): ThemeName {
  if (!("store" in context)) {
    return defaultTheme;
  }
  const { store } = context;
  if (
    typeof store !== "object" ||
    store === null ||
    !("userGlobals" in store)
  ) {
    return defaultTheme;
  }
  const { userGlobals } = store;
  if (
    typeof userGlobals !== "object" ||
    userGlobals === null ||
    !("get" in userGlobals) ||
    typeof userGlobals.get !== "function"
  ) {
    return defaultTheme;
  }
  const globals: unknown = userGlobals.get();
  if (
    typeof globals === "object" &&
    globals !== null &&
    "theme" in globals &&
    isThemeName(globals.theme)
  ) {
    return globals.theme;
  }
  return defaultTheme;
}

export function ThemedDocsContainer({
  children,
  context,
}: PropsWithChildren<DocsContainerProps>) {
  const [theme, setTheme] = useState(() => readTheme(context));
  const { channel } = context;

  useEffect(() => {
    const onGlobalsUpdated = ({
      globals,
    }: {
      globals: Record<string, unknown>;
    }) => {
      const value = globals["theme"];
      if (isThemeName(value)) {
        setTheme(value);
      }
    };
    channel.on(GLOBALS_UPDATED, onGlobalsUpdated);
    return () => channel.off(GLOBALS_UPDATED, onGlobalsUpdated);
  }, [channel]);

  useEffect(() => {
    document.documentElement.dataset["theme"] = theme;
  }, [theme]);

  return (
    <DocsContainer
      context={context}
      theme={theme === "dark" ? themes.dark : themes.light}
    >
      {children}
    </DocsContainer>
  );
}
