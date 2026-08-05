export interface ScriptSourceFrame {
  readonly column: number;
  readonly displayPath: string;
  readonly line: number;
  readonly url: string;
}

// `Function` contributes two wrapper lines and scriptLoader adds one strict-mode
// prologue line before author source.
const COMMONJS_LINE_OFFSET = 3;
const SCRIPT_FRAME_PATTERN = /(lucent-script:\/\/[^\s)]+):(\d+):(\d+)/g;

const decodeSegment = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const displayPathFromUrl = (value: string): string => {
  try {
    const url = new URL(value);
    const segments = url.pathname
      .split("/")
      .filter((segment) => segment !== "")
      .map(decodeSegment);
    if (url.hostname === "package") {
      const packageName = segments.shift();
      return packageName === undefined
        ? value
        : [packageName, ...segments].join("/");
    }
    if (url.hostname === "loose") return segments.join("/") || value;
    return decodeSegment(url.hostname) || value;
  } catch {
    return value;
  }
};

/** Removes the fixed CommonJS wrapper offset from Lucent-owned stack frames. */
export const normalizeScriptSourceStack = (stack: string): string =>
  stack.replace(
    SCRIPT_FRAME_PATTERN,
    (_frame, url: string, rawLine: string, rawColumn: string) => {
      const line = Math.max(1, Number(rawLine) - COMMONJS_LINE_OFFSET);
      return `${url}:${line}:${rawColumn}`;
    },
  );

export const firstScriptSourceFrame = (
  stack: string | undefined,
): ScriptSourceFrame | undefined => {
  if (stack === undefined) return undefined;
  const normalized = normalizeScriptSourceStack(stack);
  SCRIPT_FRAME_PATTERN.lastIndex = 0;
  const match = SCRIPT_FRAME_PATTERN.exec(normalized);
  SCRIPT_FRAME_PATTERN.lastIndex = 0;
  if (match === null) return undefined;
  const [, url, rawLine, rawColumn] = match;
  if (url === undefined || rawLine === undefined || rawColumn === undefined) {
    return undefined;
  }
  return {
    column: Number(rawColumn),
    displayPath: displayPathFromUrl(url),
    line: Number(rawLine),
    url,
  };
};

const errorChain = (error: Error): readonly Error[] => {
  const chain: Error[] = [];
  const seen = new Set<Error>();
  let current: Error | undefined = error;
  while (current !== undefined && !seen.has(current)) {
    seen.add(current);
    chain.push(current);
    const cause: unknown = Reflect.get(current, "cause");
    current = cause instanceof Error ? cause : undefined;
  }
  return chain;
};

export const attributedScriptErrorMessage = (error: Error): string => {
  for (const entry of errorChain(error)) {
    const frame = firstScriptSourceFrame(entry.stack);
    if (frame !== undefined) {
      return `${frame.displayPath}:${frame.line}:${frame.column}: ${error.message}`;
    }
  }
  return error.message;
};

export const attributedScriptErrorDetails = (
  error: Error,
): string | undefined => {
  const details = errorChain(error)
    .map((entry) =>
      entry.stack?.trim() === ""
        ? entry.message
        : normalizeScriptSourceStack(entry.stack ?? entry.message),
    )
    .filter((entry) => entry.trim() !== "");
  return details.length === 0 ? undefined : details.join("\nCaused by:\n");
};
