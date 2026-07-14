import { isAbsolute, resolve } from "path";

import type { AppLaunchMode } from "@lucent/core/settings";
import { isAppLaunchMode } from "@lucent/core/settings";

export const DEFAULT_OBSERVABILITY_PORT = 10_637;

export interface ObservabilityCliOptions {
  readonly port: number;
}

export interface CliOptions {
  readonly flashPluginPath?: string;
  readonly flashVersion?: string;
  readonly launchMode?: AppLaunchMode;
  readonly obs?: ObservabilityCliOptions;
}

type CliOptionName = "flashPluginPath" | "flashVersion" | "launchMode" | "obs";

const optionNames: Readonly<Record<string, CliOptionName>> = {
  "flash-plugin-path": "flashPluginPath",
  "flash-version": "flashVersion",
  flashPath: "flashPluginPath",
  flashVersion: "flashVersion",
  "launch-mode": "launchMode",
  launchMode: "launchMode",
  obs: "obs",
};

const normalizeOptional = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
};

const normalizeCliPath = (path: string, cwd = process.cwd()): string => {
  const trimmed = path.trim();
  return isAbsolute(trimmed) ? trimmed : resolve(cwd, trimmed);
};

const readFlagValue = (
  argv: readonly string[],
  index: number,
  rawValue: string | undefined,
): { readonly value?: string; readonly nextIndex: number } => {
  if (rawValue !== undefined) {
    return { value: rawValue, nextIndex: index };
  }

  const next = argv[index + 1];
  if (next === undefined || next.startsWith("--")) {
    return { nextIndex: index };
  }

  return { value: next, nextIndex: index + 1 };
};

const parseLaunchMode = (
  value: string | undefined,
): AppLaunchMode | undefined => {
  const normalized = normalizeOptional(value)?.toLowerCase();
  if (normalized === "manager") {
    return "account-manager";
  }

  return isAppLaunchMode(normalized) ? normalized : undefined;
};

const parseObservabilityOptions = (
  value: string | undefined,
): ObservabilityCliOptions => {
  const normalized = normalizeOptional(value);
  if (normalized === undefined) {
    return { port: DEFAULT_OBSERVABILITY_PORT };
  }

  const port = Number(normalized);
  return Number.isSafeInteger(port) && port >= 1 && port <= 65_535
    ? { port }
    : { port: DEFAULT_OBSERVABILITY_PORT };
};

export const parseCliOptions = (
  argv: readonly string[],
  options: { readonly cwd?: string } = {},
): CliOptions => {
  const cwd = options.cwd ?? process.cwd();
  const output: {
    flashPluginPath?: string;
    flashVersion?: string;
    launchMode?: AppLaunchMode;
    obs?: ObservabilityCliOptions;
  } = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined || !arg.startsWith("--")) {
      continue;
    }

    const source = arg.slice(2);
    const equalsIndex = source.indexOf("=");
    const key = equalsIndex === -1 ? source : source.slice(0, equalsIndex);
    const optionName = optionNames[key];
    if (optionName === undefined) {
      continue;
    }

    const rawValue =
      equalsIndex === -1 ? undefined : source.slice(equalsIndex + 1);
    const { value, nextIndex } = readFlagValue(argv, index, rawValue);
    index = nextIndex;

    if (optionName === "obs") {
      output.obs = parseObservabilityOptions(value);
      continue;
    }

    if (optionName === "launchMode") {
      const launchMode = parseLaunchMode(value);
      if (launchMode !== undefined) {
        output.launchMode = launchMode;
      }
      continue;
    }

    const normalized = normalizeOptional(value);
    if (normalized !== undefined) {
      output[optionName] =
        optionName === "flashPluginPath"
          ? normalizeCliPath(normalized, cwd)
          : normalized;
    }
  }

  return output;
};
