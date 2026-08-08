const SCRIPT_PATH_ELLIPSIS = "…";

// Reserve room for row padding, actions, and the script name before estimating
// how much directory context can fit at the smaller context font size.
const SCRIPT_ROW_RESERVED_WIDTH = 288;
const SCRIPT_CONTEXT_CHARACTER_WIDTH = 6;
const SCRIPT_CONTEXT_MIN_CHARACTERS = 20;

export const scriptContextCharacterLimit = (viewportWidth: number): number => {
  if (viewportWidth <= 0) return Number.POSITIVE_INFINITY;
  return Math.max(
    SCRIPT_CONTEXT_MIN_CHARACTERS,
    Math.floor(
      (viewportWidth - SCRIPT_ROW_RESERVED_WIDTH) /
        SCRIPT_CONTEXT_CHARACTER_WIDTH,
    ),
  );
};

/** Keeps the first path segment and as many trailing segments as will fit. */
export const truncatePathContext = (
  path: string,
  maximumCharacters: number,
): string => {
  if (path.length <= maximumCharacters) return path;

  const segments = path.split("/");
  const first = segments[0];
  const last = segments.at(-1);
  if (segments.length < 3 || first === undefined || last === undefined) {
    return path;
  }

  const suffix = [last];
  const shortestPath = `${first}/${SCRIPT_PATH_ELLIPSIS}/${last}`;
  if (shortestPath.length > maximumCharacters) {
    return `${SCRIPT_PATH_ELLIPSIS}/${last}`;
  }

  for (let index = segments.length - 2; index > 0; index -= 1) {
    const segment = segments[index];
    if (segment === undefined) continue;
    const candidate = `${first}/${SCRIPT_PATH_ELLIPSIS}/${segment}/${suffix.join("/")}`;
    if (candidate.length > maximumCharacters) break;
    suffix.unshift(segment);
  }

  return `${first}/${SCRIPT_PATH_ELLIPSIS}/${suffix.join("/")}`;
};
