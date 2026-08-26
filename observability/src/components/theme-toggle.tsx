import { MoonIcon, SunIcon } from "lucide-react";
import * as React from "react";

import { useTheme } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";

const COLOR_SCHEME_QUERY = "(prefers-color-scheme: dark)";

export function ThemeToggle() {
  const { setTheme, theme } = useTheme();
  const [systemDark, setSystemDark] = React.useState(
    () => window.matchMedia(COLOR_SCHEME_QUERY).matches,
  );

  React.useEffect(() => {
    const mediaQuery = window.matchMedia(COLOR_SCHEME_QUERY);
    const update = () => setSystemDark(mediaQuery.matches);
    mediaQuery.addEventListener("change", update);
    return () => mediaQuery.removeEventListener("change", update);
  }, []);

  const dark = theme === "dark" || (theme === "system" && systemDark);

  return (
    <Button
      aria-label="Dark mode"
      aria-pressed={dark}
      onClick={() => setTheme(dark ? "light" : "dark")}
      size="icon-sm"
      title={dark ? "Use light theme" : "Use dark theme"}
      variant="ghost"
    >
      {dark ? (
        <MoonIcon aria-hidden="true" strokeWidth={1.5} />
      ) : (
        <SunIcon aria-hidden="true" strokeWidth={1.5} />
      )}
    </Button>
  );
}
