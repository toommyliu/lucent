import type { ScriptRunnerStatus } from "./ScriptRunner";

export interface FatalScriptAlert {
  readonly key: string;
  readonly sourceName: string;
  readonly sourcePath?: string;
  readonly message: string;
  readonly detailsText?: string;
}

let nextErrorAlertId = 0;

const errorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message !== "") {
    return error.message;
  }

  if (typeof error === "object" && error !== null) {
    const message = Reflect.get(error, "message");
    if (typeof message === "string" && message !== "") {
      return message;
    }
  }

  return String(error);
};

const errorDetailsText = (error: unknown): string | undefined => {
  if (error instanceof Error && error.stack?.trim() !== "") {
    return error.stack;
  }

  try {
    const details = JSON.stringify(error, null, 2);
    return details === undefined || details.trim() === "" ? undefined : details;
  } catch {
    return undefined;
  }
};

export const fatalScriptAlertFromError = (
  sourceName: string,
  error: unknown,
  sourcePath?: string,
): FatalScriptAlert => {
  const detailsText = errorDetailsText(error);
  return {
    key: `error:${(nextErrorAlertId += 1).toString(36)}`,
    sourceName,
    ...(sourcePath === undefined ? {} : { sourcePath }),
    message: errorMessage(error),
    ...(detailsText === undefined ? {} : { detailsText }),
  };
};

export const fatalScriptAlertFromStatus = (
  status: Extract<ScriptRunnerStatus, { readonly state: "failed" }>,
): FatalScriptAlert => ({
  key: `status:${status.failedAt}:${status.name}`,
  sourceName: status.name,
  ...(status.path === undefined ? {} : { sourcePath: status.path }),
  message: status.message,
  ...(status.detailsText === undefined
    ? {}
    : { detailsText: status.detailsText }),
});
