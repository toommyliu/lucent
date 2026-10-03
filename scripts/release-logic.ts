import { parse, SemVer } from "semver";

export const RELEASE_NOTES_PLACEHOLDER = "<!-- release-notes-placeholder -->";
export const RELEASE_NOTES_PLACEHOLDER_CONTENT = `${RELEASE_NOTES_PLACEHOLDER}

Write the v0.0.1 release notes here before preparing the release.
`;

export const BUMP_KINDS = ["patch", "minor", "major"] as const;

export type BumpKind = (typeof BUMP_KINDS)[number];

export type StableRelease = {
  readonly tag: string;
  readonly version: SemVer;
};

export type TargetVersionResult =
  | { readonly ok: true; readonly version: string }
  | { readonly ok: false; readonly message: string };

export const isBumpKind = (value: string): value is BumpKind =>
  BUMP_KINDS.includes(value as BumpKind);

export const parseStableVersion = (value: string): SemVer | null => {
  const version = parse(value);
  return version !== null &&
    version.prerelease.length === 0 &&
    version.version === value
    ? version
    : null;
};

export const parseStableReleaseTag = (tag: string): SemVer | null =>
  tag.startsWith("v") ? parseStableVersion(tag.slice(1)) : null;

export const formatVersion = (version: SemVer): string => version.version;

export const formatReleaseTag = (version: string): string => `v${version}`;

export const findFirstStableRelease = (
  tags: ReadonlyArray<string>,
): StableRelease | null => {
  for (const tag of tags) {
    const version = parseStableReleaseTag(tag);
    if (version !== null) {
      return { tag, version };
    }
  }

  return null;
};

export const resolveTargetVersion = (
  bumpOrVersion: string,
  latestRelease: StableRelease | null,
): TargetVersionResult => {
  if (isBumpKind(bumpOrVersion)) {
    return latestRelease === null
      ? {
          ok: false,
          message:
            "The first release requires an explicit stable version like 0.0.1.",
        }
      : {
          ok: true,
          version: new SemVer(latestRelease.version.version).inc(bumpOrVersion)
            .version,
        };
  }

  const parsed = parseStableVersion(bumpOrVersion);
  if (parsed === null) {
    return {
      ok: false,
      message:
        "Release version must be patch, minor, major, or a stable version like 0.9.0.",
    };
  }

  if (latestRelease !== null && parsed.compare(latestRelease.version) <= 0) {
    return {
      ok: false,
      message: `Target version ${bumpOrVersion} must be greater than latest release ${latestRelease.tag}.`,
    };
  }

  return { ok: true, version: formatVersion(parsed) };
};

export const releaseNotesAreReady = (source: string): boolean =>
  source.trim().length > 0 && !source.includes(RELEASE_NOTES_PLACEHOLDER);

export const makeInitialChangelog = (options: {
  readonly date: string;
  readonly notes: string;
  readonly tag: string;
  readonly version: string;
}): string =>
  [
    "# Changelog",
    "",
    "All notable changes to this project will be documented in this file.",
    "",
    `# [${options.version}](https://github.com/toommyliu/lucent/tree/${options.tag}) - (${options.date})`,
    options.notes.trim(),
    "",
  ].join("\n");

const gitCliffBaseArgs = (tag: string): ReadonlyArray<string> => [
  "--config",
  "cliff.toml",
  "--unreleased",
  "--tag",
  tag,
];

export const gitCliffChangelogArgs = (tag: string): ReadonlyArray<string> => [
  ...gitCliffBaseArgs(tag),
  "--prepend",
  "CHANGELOG.md",
];

export const validateReleaseInputs = (options: {
  readonly packageVersion: unknown;
  readonly tag: string;
}): string | null => {
  if (
    typeof options.packageVersion !== "string" ||
    parseStableVersion(options.packageVersion) === null
  ) {
    return "app/package.json must contain a stable semantic version.";
  }

  const expectedTag = formatReleaseTag(options.packageVersion);
  if (options.tag !== expectedTag) {
    return `Release tag ${options.tag} does not match app version ${options.packageVersion}. Expected ${expectedTag}.`;
  }

  return null;
};

export const extractReleaseNotesFromChangelog = (
  changelog: string,
  tag: string,
): string | null => {
  const version = parseStableReleaseTag(tag);
  if (version === null) {
    return null;
  }

  const expectedVersion = formatVersion(version);
  const headingPattern =
    /^# \[([^\]]+)\]\([^\r\n]+\) - \(\d{4}-\d{2}-\d{2}\)\s*$/gm;
  const headings = [...changelog.matchAll(headingPattern)];
  const headingIndex = headings.findIndex(
    (match) => match[1] === expectedVersion,
  );
  const heading = headings[headingIndex];
  if (headingIndex === -1 || heading?.index === undefined) {
    return null;
  }

  const nextHeading = headings[headingIndex + 1];
  const start = heading.index + heading[0].length;
  const end = nextHeading?.index ?? changelog.length;
  const notes = changelog.slice(start, end).trim();

  return notes.length > 0 ? `${notes}\n` : null;
};
