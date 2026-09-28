import type { AppLaunchMode } from "@lucent/core/settings";
import { isAppLaunchMode } from "@lucent/core/settings";

export interface CliOptions {
  readonly debug?: boolean;
  readonly launchMode?: AppLaunchMode;
  readonly traceProjections?: boolean;
}

type CliOptionName = "launchMode";

const optionNames: Readonly<Record<string, CliOptionName>> = {
  "launch-mode": "launchMode",
  launchMode: "launchMode",
};

const normalizeOptional = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
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

export const parseCliOptions = (argv: readonly string[]): CliOptions => {
  const output: {
    debug?: boolean;
    launchMode?: AppLaunchMode;
    traceProjections?: boolean;
  } = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined || !arg.startsWith("--")) {
      continue;
    }

    if (arg === "--debug") {
      output.debug = true;
      continue;
    }

    if (arg === "--trace-projections") {
      // Projection traces are inspected through desktop observability.
      output.debug = true;
      output.traceProjections = true;
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

    const launchMode = parseLaunchMode(value);
    if (launchMode !== undefined) {
      output.launchMode = launchMode;
    }
  }

  return output;
};
