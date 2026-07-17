export const DEBUG_MODE_ARGUMENT = "--lucent__debug";
export const GAME_CONSOLE_OBSERVABILITY_ARGUMENT =
  "--lucent__gameConsoleObservability";

export const serializeDebugModeArgument = (): string => DEBUG_MODE_ARGUMENT;

export const serializeGameConsoleObservabilityArgument = (): string =>
  GAME_CONSOLE_OBSERVABILITY_ARGUMENT;

export const readDebugModeArgument = (argv: readonly string[]): boolean =>
  argv.includes(DEBUG_MODE_ARGUMENT);

export const readGameConsoleObservabilityArgument = (
  argv: readonly string[],
): boolean => argv.includes(GAME_CONSOLE_OBSERVABILITY_ARGUMENT);
