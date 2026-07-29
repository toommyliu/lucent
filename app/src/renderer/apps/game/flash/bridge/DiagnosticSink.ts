import { Context, Layer } from "effect";

import { makeDiagnostic, type DiagnosticPhase } from "../contract/Diagnostic";

export interface DiagnosticSinkService {
  readonly report: (
    phase: DiagnosticPhase,
    operation: string,
    cause: unknown,
    args?: readonly unknown[],
  ) => void;
}

const noop: DiagnosticSinkService = {
  report: () => undefined,
};

const debug: DiagnosticSinkService = {
  report: (phase, operation, cause, args) => {
    const diagnostic = makeDiagnostic(phase, operation, cause, args);
    if (phase === "projection-trace") {
      console.debug("[flash:projection]", diagnostic);
      return;
    }
    console.warn("[flash:diagnostic]", diagnostic);
  },
};

export class DiagnosticSink extends Context.Reference<DiagnosticSinkService>(
  "lucent/renderer/flash/DiagnosticSink",
  { defaultValue: () => noop },
) {}

export const noopLayer = Layer.succeed(DiagnosticSink, noop);
export const debugLayer = Layer.succeed(DiagnosticSink, debug);
