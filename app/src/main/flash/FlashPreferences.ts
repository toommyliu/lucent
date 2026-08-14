import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  writeFileSync,
} from "fs";
import { basename, dirname, join } from "path";

const AQW_PREFERENCE_FILE_NAMES = [
  "AQLite_Data.sol",
  "AQWUserPref.sol",
] as const;
const PREFERENCE_SEED_MARKER = ".lucent-aqw-preferences-v1";

const isMissing = (cause: unknown): boolean =>
  cause instanceof Error &&
  "code" in cause &&
  (cause as { readonly code?: unknown }).code === "ENOENT";

const sharedObjectRoots = (flashRootPath: string): readonly string[] => {
  const directory = join(flashRootPath, "#SharedObjects");
  try {
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(directory, entry.name));
  } catch (cause) {
    if (isMissing(cause)) return [];
    throw cause;
  }
};

const findSourcePreferences = (
  flashRootPath: string,
): {
  readonly directory: string;
  readonly fileNames: readonly (typeof AQW_PREFERENCE_FILE_NAMES)[number][];
} | null => {
  for (const root of sharedObjectRoots(flashRootPath)) {
    const directory = join(root, "game.aq.com");
    const fileNames = AQW_PREFERENCE_FILE_NAMES.filter((fileName) =>
      existsSync(join(directory, fileName)),
    );
    if (fileNames.length > 0) return { directory, fileNames };
  }
  return null;
};

export const initializeAqwFlashPreferenceTemplate = (input: {
  readonly sourceRootPaths: readonly string[];
  readonly templateRootPath: string;
}): boolean => {
  if (findSourcePreferences(input.templateRootPath) !== null) return false;

  const source = input.sourceRootPaths
    .map(findSourcePreferences)
    .find((candidate) => candidate !== null);
  if (source === undefined) return false;

  const destination = join(
    input.templateRootPath,
    "#SharedObjects",
    basename(dirname(source.directory)),
    "game.aq.com",
  );
  mkdirSync(destination, { recursive: true });
  for (const fileName of source.fileNames) {
    copyFileSync(join(source.directory, fileName), join(destination, fileName));
  }
  return true;
};

/**
 * Seeds an isolated Flash profile from the neutral AQW preference template.
 * The marker makes this a migration rather than a recurring overwrite.
 */
export const seedAqwFlashPreferences = (input: {
  readonly targetRootPath: string;
  readonly templateRootPath: string;
}): boolean => {
  const markerPath = join(input.targetRootPath, PREFERENCE_SEED_MARKER);
  if (existsSync(markerPath)) return false;

  const source = findSourcePreferences(input.templateRootPath);
  if (source === null) return false;

  const targetRoots = sharedObjectRoots(input.targetRootPath);
  const destinations =
    targetRoots.length > 0
      ? targetRoots.map((root) => join(root, "game.aq.com"))
      : [
          join(
            input.targetRootPath,
            "#SharedObjects",
            basename(dirname(source.directory)),
            "game.aq.com",
          ),
        ];

  for (const destination of destinations) {
    mkdirSync(destination, { recursive: true });
    for (const fileName of source.fileNames) {
      copyFileSync(
        join(source.directory, fileName),
        join(destination, fileName),
      );
    }
  }

  writeFileSync(markerPath, "1\n", "utf8");
  return true;
};
