export const GAME_CONSOLE_OBSERVABILITY_ARGUMENT =
  "--lucent__gameConsoleObservability";

export const serializeGameConsoleObservabilityArgument = (): string =>
  GAME_CONSOLE_OBSERVABILITY_ARGUMENT;

export const readGameConsoleObservabilityArgument = (
  argv: readonly string[],
): boolean => argv.includes(GAME_CONSOLE_OBSERVABILITY_ARGUMENT);
