import {
  sanitizeLogValue,
  type ObservabilityInput,
  type ObservabilityLevel,
} from "../../../shared/observability";
import type { ObservabilityBridge } from "../../../shared/ipc";

type ConsoleMethod = "debug" | "error" | "info" | "log" | "warn";

const consoleMethods = ["debug", "log", "info", "warn", "error"] as const;

const consoleMethodLevel = (method: ConsoleMethod): ObservabilityLevel =>
  method === "debug"
    ? "debug"
    : method === "warn"
      ? "warn"
      : method === "error"
        ? "error"
        : "info";

const electronLevelForObservabilityLevel = (
  level: ObservabilityLevel,
): number =>
  level === "debug" ? 0 : level === "warn" ? 2 : level === "error" ? 3 : 1;

const shouldCaptureConsoleArgument = (value: unknown): boolean =>
  (typeof value === "object" && value !== null) ||
  typeof value === "bigint" ||
  typeof value === "symbol";

export const shouldCaptureConsoleArguments = (
  args: readonly unknown[],
): boolean => args.some(shouldCaptureConsoleArgument);

const stringify = (value: unknown): string => {
  try {
    const result = JSON.stringify(value);
    return result === undefined ? String(value) : result;
  } catch {
    return String(value);
  }
};

export const formatConsoleArgument = (value: unknown): string => {
  if (value instanceof Error) {
    return value.stack || `${value.name}: ${value.message}`;
  }

  const sanitized = sanitizeLogValue(value);
  if (typeof sanitized === "string") {
    return sanitized;
  }

  if (
    sanitized === null ||
    typeof sanitized === "number" ||
    typeof sanitized === "boolean" ||
    typeof sanitized === "bigint"
  ) {
    return String(sanitized);
  }

  if (sanitized === undefined) {
    return "undefined";
  }

  return stringify(sanitized);
};

const nativeConsoleArgumentText = (value: unknown): string => {
  try {
    return typeof value === "string" ? value : String(value);
  } catch {
    return "[Unformattable]";
  }
};

export const nativeConsoleMessage = (args: readonly unknown[]): string =>
  args.map(nativeConsoleArgumentText).join(" ");

export const makeConsoleObservabilityInput = (
  method: ConsoleMethod,
  args: readonly unknown[],
): ObservabilityInput => {
  const level = consoleMethodLevel(method);
  const renderedArgs = args.map(formatConsoleArgument);
  return {
    level,
    source: "game",
    component: "game-window",
    message: renderedArgs.join(" "),
    data: {
      kind: "console-message",
      consoleLevel: level,
      electronLevel: electronLevelForObservabilityLevel(level),
      line: 0,
      sourceId: "renderer-console",
      capturedBy: "renderer-console",
      args: args.map(sanitizeLogValue),
      renderedArgs,
      nativeMessage: nativeConsoleMessage(args),
    },
  };
};

export const installGameConsoleObservabilityBridge = (
  bridge: Pick<ObservabilityBridge, "write">,
  consoleTarget: Pick<Console, ConsoleMethod>,
): void => {
  const marker = "__lucentConsoleObservabilityBridgeInstalled";
  const target = consoleTarget as Pick<Console, ConsoleMethod> & {
    [marker]?: boolean;
  };
  if (target[marker]) {
    return;
  }

  target[marker] = true;
  const originals = Object.fromEntries(
    consoleMethods.map((method) => [
      method,
      target[method].bind(consoleTarget) as (...args: unknown[]) => void,
    ]),
  ) as Record<ConsoleMethod, (...args: unknown[]) => void>;

  for (const method of consoleMethods) {
    target[method] = ((...args: unknown[]) => {
      const original = originals[method];
      if (!shouldCaptureConsoleArguments(args)) {
        original(...args);
        return;
      }

      try {
        void bridge
          .write(makeConsoleObservabilityInput(method, args))
          .catch((error: unknown) => {
            originals.error("Failed to capture console observability:", error);
          });
      } catch (error: unknown) {
        originals.error("Failed to capture console observability:", error);
      } finally {
        original(...args);
      }
    }) as Console[ConsoleMethod];
  }
};
