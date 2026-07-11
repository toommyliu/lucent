import { Effect } from "effect";

export type DiagnosticPhase =
  | "callback-decode"
  | "callback-dispatch"
  | "invoke"
  | "packet-decode"
  | "projection";

export interface Diagnostic {
  readonly arguments?: readonly unknown[];
  readonly cause: unknown;
  readonly operation: string;
  readonly phase: DiagnosticPhase;
  readonly timestamp: number;
}

export type DiagnosticReporter = (
  operation: string,
  cause: unknown,
  args?: readonly unknown[],
) => Effect.Effect<void>;

export const ignoreDiagnostic: DiagnosticReporter = () => Effect.void;

const sensitiveKey = /credential|password|secret|token/iu;

const redact = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(redact);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      sensitiveKey.test(key) ? "[redacted]" : redact(entry),
    ]),
  );
};

export const redactArguments = (
  operation: string,
  args: readonly unknown[],
): readonly unknown[] =>
  operation === "auth.login"
    ? [args[0], args.length > 1 ? "[redacted]" : undefined]
    : args.map(redact);

export const makeDiagnostic = (
  phase: DiagnosticPhase,
  operation: string,
  cause: unknown,
  args?: readonly unknown[],
): Diagnostic => ({
  ...(args === undefined
    ? {}
    : { arguments: redactArguments(operation, args) }),
  cause,
  operation,
  phase,
  timestamp: Date.now(),
});
