import { isRecord } from "./errorDetails";
import type { ScriptDiagnostic } from "./Types";

export interface FatalScriptAlert {
  readonly key: string;
  readonly sourceName: string;
  readonly sourcePath?: string;
  readonly message: string;
  readonly detailsText?: string;
}

export interface FatalScriptAlertCandidateOptions {
  readonly wasRunning: boolean;
  readonly isRunning: boolean;
  readonly diagnostics: ReadonlyArray<ScriptDiagnostic>;
  readonly lastShownKey: string;
  readonly sourcePath?: string;
}

let nextErrorAlertId = 0;

const findStackTrace = (
  value: unknown,
  seen = new WeakSet<object>(),
): string | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  if (seen.has(value)) {
    return undefined;
  }
  seen.add(value);

  const stack = value["stack"];
  if (typeof stack === "string" && stack.trim() !== "") {
    return stack;
  }

  for (const nested of Object.values(value)) {
    if (Array.isArray(nested)) {
      for (const item of nested) {
        const stackTrace = findStackTrace(item, seen);
        if (stackTrace !== undefined) {
          return stackTrace;
        }
      }
      continue;
    }

    const stackTrace = findStackTrace(nested, seen);
    if (stackTrace !== undefined) {
      return stackTrace;
    }
  }

  return undefined;
};

export const diagnosticDetailsText = (
  details: ScriptDiagnostic["details"],
): string | undefined => {
  if (details === undefined) {
    return undefined;
  }

  const stackTrace = findStackTrace(details);
  if (stackTrace !== undefined) {
    return stackTrace;
  }

  return JSON.stringify(details, null, 2);
};

export const fatalScriptAlertFromDiagnostic = (
  diagnostic: ScriptDiagnostic,
  sourcePath?: string,
): FatalScriptAlert => {
  const detailsText = diagnosticDetailsText(diagnostic.details);
  return {
    key: `diagnostic:${diagnostic.id}`,
    sourceName: diagnostic.sourceName,
    ...(sourcePath === undefined ? null : { sourcePath }),
    message: diagnostic.message,
    ...(detailsText === undefined ? null : { detailsText }),
  };
};

export const fatalScriptAlertFromError = (
  sourceName: string,
  message: string,
  detailsText: string | undefined,
  sourcePath?: string,
): FatalScriptAlert => ({
  key: `error:${(nextErrorAlertId += 1).toString(36)}`,
  sourceName,
  ...(sourcePath === undefined ? null : { sourcePath }),
  message,
  ...(detailsText === undefined ? null : { detailsText }),
});

export const stoppedScriptFatalAlertCandidate = ({
  wasRunning,
  isRunning,
  diagnostics,
  lastShownKey,
  sourcePath,
}: FatalScriptAlertCandidateOptions): FatalScriptAlert | undefined => {
  if (!wasRunning || isRunning) {
    return undefined;
  }

  const latestError = diagnostics
    .toReversed()
    .find((diagnostic) => diagnostic.severity === "error");
  if (latestError === undefined) {
    return undefined;
  }

  const alert = fatalScriptAlertFromDiagnostic(latestError, sourcePath);
  return alert.key === lastShownKey ? undefined : alert;
};
