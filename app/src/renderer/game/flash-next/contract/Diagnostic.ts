export type DiagnosticPhase =
  | "callback-decode"
  | "callback-dispatch"
  | "invoke"
  | "packet-decode"
  | "projection";

export interface Diagnostic {
  readonly cause: unknown;
  readonly operation: string;
  readonly phase: DiagnosticPhase;
  readonly timestamp: number;
}

export const makeDiagnostic = (
  phase: DiagnosticPhase,
  operation: string,
  cause: unknown,
): Diagnostic => ({
  cause,
  operation,
  phase,
  timestamp: Date.now(),
});
