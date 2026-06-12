import { isWindowId, type WindowId } from "./windows";

export const WINDOW_STARTUP_CONTEXT_ARGUMENT = "--window-startup-context";

export type PreloadWindowContext =
  | {
      readonly kind: "game";
      readonly label: "Game";
    }
  | {
      readonly kind: "app" | "game-child";
      readonly id: WindowId;
      readonly label: string;
    };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const isPreloadWindowContext = (
  value: unknown,
): value is PreloadWindowContext => {
  if (!isRecord(value)) {
    return false;
  }

  if (value["kind"] === "game") {
    return value["label"] === "Game";
  }

  return (
    (value["kind"] === "app" || value["kind"] === "game-child") &&
    isWindowId(value["id"]) &&
    typeof value["label"] === "string" &&
    value["label"].trim() !== ""
  );
};

export const serializePreloadWindowContextArgument = (
  context: PreloadWindowContext,
): string =>
  `${WINDOW_STARTUP_CONTEXT_ARGUMENT}=${encodeURIComponent(
    JSON.stringify(context),
  )}`;

export const readPreloadWindowContextArgument = (
  argv: readonly string[],
): PreloadWindowContext | null => {
  const prefix = `${WINDOW_STARTUP_CONTEXT_ARGUMENT}=`;
  const raw = argv.find((arg) => arg.startsWith(prefix));
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(decodeURIComponent(raw.slice(prefix.length)));
    return isPreloadWindowContext(parsed) ? parsed : null;
  } catch {
    return null;
  }
};
