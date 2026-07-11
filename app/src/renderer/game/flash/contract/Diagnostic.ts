import { Effect } from "effect";

export type DiagnosticPhase =
  | "callback-decode"
  | "callback-dispatch"
  | "invoke"
  | "packet-decode"
  | "projection"
  | "projection-trace";

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

export const makeDiagnostic = (
  phase: DiagnosticPhase,
  operation: string,
  cause: unknown,
  args?: readonly unknown[],
): Diagnostic => ({
  ...(args === undefined ? {} : { arguments: args }),
  cause,
  operation,
  phase,
  timestamp: Date.now(),
});
