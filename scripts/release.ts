import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Console from "effect/Console";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { ChildProcess } from "effect/unstable/process";

import {
  findFirstStableRelease,
  formatReleaseTag,
  formatVersion,
  gitCliffChangelogArgs,
  makeInitialChangelog,
  parseStableVersion,
  RELEASE_NOTES_PLACEHOLDER_CONTENT,
  releaseNotesAreReady,
  resolveTargetVersion,
  type StableRelease,
} from "./release-logic";

const execFileAsync = promisify(execFile);

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SCRIPT_DIR, "..");
const APP_PACKAGE_JSON_PATH = join(REPO_ROOT, "app", "package.json");
const CHANGELOG_PATH = join(REPO_ROOT, "CHANGELOG.md");
const RELEASE_NOTES_PATH = join(REPO_ROOT, "RELEASE_NOTES.md");
const RELEASE_BRANCH = "main";
const RELEASE_FILES = ["app/package.json", "CHANGELOG.md"] as const;

type CliInput = {
  readonly bumpOrVersion: string;
  readonly dryRun: boolean;
  readonly allowDirty: boolean;
};

type AppPackageJson = {
  readonly name?: unknown;
  readonly version?: unknown;
  readonly [key: string]: unknown;
};

class ReleaseError extends Data.TaggedError("ReleaseError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

const toErrorMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

const toRelativePath = (path: string): string => {
  const value = relative(REPO_ROOT, path);
  return value === "" ? "." : value.split(sep).join("/");
};

const runGit = (
  args: ReadonlyArray<string>,
): Effect.Effect<string, ReleaseError> =>
  Effect.tryPromise({
    try: async () => {
      const { stdout } = await execFileAsync("git", [...args], {
        cwd: REPO_ROOT,
        encoding: "utf8",
        maxBuffer: 10 * 1024 * 1024,
      });
      // Porcelain status uses a leading space as one of its two state bytes.
      return stdout.trimEnd();
    },
    catch: (cause) =>
      new ReleaseError({
        message: `git ${args.join(" ")} failed`,
        cause,
      }),
  });

const validateRepoRoot = (): Effect.Effect<void, ReleaseError> =>
  Effect.gen(function* () {
    const packageJsonPath = join(REPO_ROOT, "package.json");
    const source = yield* Effect.tryPromise({
      try: () => readFile(packageJsonPath, "utf8"),
      catch: (cause) =>
        new ReleaseError({
          message: `Failed to read ${toRelativePath(packageJsonPath)}`,
          cause,
        }),
    });

    const parsed = yield* Effect.try({
      try: () => JSON.parse(source) as { name?: unknown },
      catch: (cause) =>
        new ReleaseError({
          message: `Failed to parse ${toRelativePath(packageJsonPath)}`,
          cause,
        }),
    });

    if (parsed.name !== "lucent") {
      return yield* new ReleaseError({
        message: `Refusing to release from unexpected repo root: ${REPO_ROOT}`,
      });
    }
  });

const getCurrentBranch = (): Effect.Effect<string, ReleaseError> =>
  runGit(["branch", "--show-current"]).pipe(
    Effect.flatMap((branch) =>
      branch === ""
        ? Effect.fail(
            new ReleaseError({
              message: "Unable to determine current git branch",
            }),
          )
        : Effect.succeed(branch),
    ),
  );

const requireReleaseBranch = (branch: string) =>
  branch === RELEASE_BRANCH
    ? Effect.void
    : Effect.fail(
        new ReleaseError({
          message: `release must run from ${RELEASE_BRANCH}. Current branch is ${branch}.`,
        }),
      );

const getLatestStableRelease = (): Effect.Effect<
  StableRelease | null,
  ReleaseError
> =>
  runGit(["tag", "--merged", RELEASE_BRANCH, "--sort=-v:refname"]).pipe(
    Effect.map((output) =>
      findFirstStableRelease(
        output.split(/\r?\n/).map((value) => value.trim()),
      ),
    ),
  );

const readAppPackageJson = (): Effect.Effect<AppPackageJson, ReleaseError> =>
  Effect.gen(function* () {
    const source = yield* Effect.tryPromise({
      try: () => readFile(APP_PACKAGE_JSON_PATH, "utf8"),
      catch: (cause) =>
        new ReleaseError({
          message: `Failed to read ${toRelativePath(APP_PACKAGE_JSON_PATH)}`,
          cause,
        }),
    });

    return yield* Effect.try({
      try: () => JSON.parse(source) as AppPackageJson,
      catch: (cause) =>
        new ReleaseError({
          message: `Failed to parse ${toRelativePath(APP_PACKAGE_JSON_PATH)}`,
          cause,
        }),
    });
  });

const getAppVersion = (packageJson: AppPackageJson) =>
  typeof packageJson.version === "string" &&
  parseStableVersion(packageJson.version) !== null
    ? Effect.succeed(packageJson.version)
    : Effect.fail(
        new ReleaseError({
          message: `${toRelativePath(APP_PACKAGE_JSON_PATH)} must contain a stable semantic version`,
        }),
      );

const resolveReleaseTargetVersion = (
  bumpOrVersion: string,
  latestRelease: StableRelease | null,
): Effect.Effect<string, ReleaseError> => {
  const result = resolveTargetVersion(bumpOrVersion, latestRelease);
  return result.ok
    ? Effect.succeed(result.version)
    : Effect.fail(new ReleaseError({ message: result.message }));
};

const tagExists = (tag: string): Effect.Effect<boolean, never> =>
  runGit(["rev-parse", "--verify", "--quiet", `refs/tags/${tag}`]).pipe(
    Effect.as(true),
    Effect.orElseSucceed(() => false),
  );

const requireNewTag = (tag: string) =>
  tagExists(tag).pipe(
    Effect.flatMap((exists) =>
      exists
        ? Effect.fail(
            new ReleaseError({ message: `Tag ${tag} already exists` }),
          )
        : Effect.void,
    ),
  );

const getDirtyStatus = (): Effect.Effect<ReadonlyArray<string>, ReleaseError> =>
  runGit(["status", "--porcelain"]).pipe(
    Effect.map((output) =>
      output === ""
        ? []
        : output.split(/\r?\n/).filter((line) => line.trim() !== ""),
    ),
  );

const checkDirtyTree = (
  dirtyStatus: ReadonlyArray<string>,
  input: CliInput,
  allowedDirtyEntries: ReadonlySet<string> = new Set(),
): Effect.Effect<void, ReleaseError> =>
  Effect.gen(function* () {
    if (dirtyStatus.length === 0) {
      return;
    }

    const unexpectedChanges = dirtyStatus.filter(
      (line) => !allowedDirtyEntries.has(line),
    );
    if (!input.allowDirty && unexpectedChanges.length > 0) {
      return yield* new ReleaseError({
        message:
          "Working tree is dirty. Commit or stash changes, or rerun with --allow-dirty.",
      });
    }

    yield* Console.log(
      unexpectedChanges.length === 0
        ? "Including curated release file changes:"
        : "Working tree has existing changes:",
    );
    for (const line of dirtyStatus) {
      yield* Console.log(`  ${line}`);
    }
  });

const readInitialReleaseNotes = (): Effect.Effect<string, ReleaseError> =>
  Effect.tryPromise({
    try: () => readFile(RELEASE_NOTES_PATH, "utf8"),
    catch: (cause) =>
      new ReleaseError({
        message: `Failed to read ${toRelativePath(RELEASE_NOTES_PATH)}`,
        cause,
      }),
  }).pipe(
    Effect.flatMap((source) =>
      releaseNotesAreReady(source)
        ? Effect.succeed(source)
        : Effect.fail(
            new ReleaseError({
              message:
                "Replace the placeholder in RELEASE_NOTES.md before preparing the first release.",
            }),
          ),
    ),
  );

const writeAppVersion = (
  packageJson: AppPackageJson,
  targetVersion: string,
): Effect.Effect<void, ReleaseError> =>
  Effect.tryPromise({
    try: () =>
      writeFile(
        APP_PACKAGE_JSON_PATH,
        `${JSON.stringify({ ...packageJson, version: targetVersion }, null, 2)}\n`,
      ),
    catch: (cause) =>
      new ReleaseError({
        message: `Failed to write ${toRelativePath(APP_PACKAGE_JSON_PATH)}`,
        cause,
      }),
  });

const writeInitialChangelog = (
  targetVersion: string,
  targetTag: string,
  releaseNotes: string,
): Effect.Effect<void, ReleaseError> =>
  Effect.tryPromise({
    try: () =>
      writeFile(
        CHANGELOG_PATH,
        makeInitialChangelog({
          date: new Date().toISOString().slice(0, 10),
          notes: releaseNotes,
          tag: targetTag,
          version: targetVersion,
        }),
      ),
    catch: (cause) =>
      new ReleaseError({
        message: `Failed to write ${toRelativePath(CHANGELOG_PATH)}`,
        cause,
      }),
  });

const resetInitialReleaseNotes = (): Effect.Effect<void, ReleaseError> =>
  Effect.tryPromise({
    try: () => writeFile(RELEASE_NOTES_PATH, RELEASE_NOTES_PLACEHOLDER_CONTENT),
    catch: (cause) =>
      new ReleaseError({
        message: `Failed to reset ${toRelativePath(RELEASE_NOTES_PATH)}`,
        cause,
      }),
  });

const runGitCliff = (args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const child = yield* ChildProcess.make(
      "git-cliff",
      args,
      {
        cwd: REPO_ROOT,
        env: process.env,
        extendEnv: true,
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
        shell: process.platform === "win32",
        detached: false,
        forceKillAfter: "30 seconds",
      },
    );
    const exitCode = Number(yield* child.exitCode);

    if (exitCode !== 0) {
      return yield* new ReleaseError({
        message: `git-cliff exited with code ${exitCode}`,
      });
    }
  }).pipe(
    Effect.mapError((cause) =>
      cause instanceof ReleaseError
        ? cause
        : new ReleaseError({
            message: "git-cliff failed",
            cause,
          }),
    ),
    Effect.scoped,
  );

const printPlan = (
  branch: string,
  latestRelease: StableRelease | null,
  appVersion: string,
  targetVersion: string,
  targetTag: string,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    yield* Console.log(`Current branch: ${branch}`);
    yield* Console.log(
      `Latest stable release tag: ${latestRelease?.tag ?? "none (first release)"}`,
    );
    yield* Console.log(`Current app/package.json version: ${appVersion}`);
    yield* Console.log(`Target version: ${targetVersion}`);
    yield* Console.log(`Target tag: ${targetTag}`);
    yield* Console.log("Files that would change:");
    for (const file of RELEASE_FILES) {
      yield* Console.log(`  ${file}`);
    }

    if (latestRelease === null) {
      yield* Console.log(
        "Changelog source: curated notes from RELEASE_NOTES.md",
      );
      return;
    }

    const args = gitCliffChangelogArgs(targetTag);
    yield* Console.log(`git-cliff command: git-cliff ${args.join(" ")}`);
  });

const printNextCommands = (
  targetVersion: string,
  targetTag: string,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const releaseBranch = `release/${targetTag}`;

    yield* Console.log("");
    yield* Console.log("Release files prepared. Next commands:");
    yield* Console.log("git diff -- app/package.json CHANGELOG.md");
    yield* Console.log(`git switch -c ${releaseBranch}`);
    yield* Console.log("git add app/package.json CHANGELOG.md");
    yield* Console.log(`git commit -m "chore(release): ${targetVersion}"`);
    yield* Console.log(`git push --set-upstream origin ${releaseBranch}`);
    yield* Console.log(
      `gh pr create --base main --head ${releaseBranch} --fill`,
    );
    yield* Console.log("");
    yield* Console.log("After the release pull request merges:");
    yield* Console.log("git switch main");
    yield* Console.log("git pull --ff-only origin main");
    yield* Console.log(`git tag ${targetTag}`);
    yield* Console.log(`git push origin ${targetTag}`);
  });

const release = (input: CliInput) =>
  Effect.gen(function* () {
    yield* validateRepoRoot();

    const branch = yield* getCurrentBranch();
    yield* requireReleaseBranch(branch);

    const latestRelease = yield* getLatestStableRelease();
    const appPackageJson = yield* readAppPackageJson();
    const appVersion = yield* getAppVersion(appPackageJson);
    const targetVersion = yield* resolveReleaseTargetVersion(
      input.bumpOrVersion,
      latestRelease,
    );
    const targetTag = formatReleaseTag(targetVersion);
    yield* requireNewTag(targetTag);

    if (
      latestRelease !== null &&
      appVersion !== formatVersion(latestRelease.version)
    ) {
      yield* Console.log(
        `Warning: app/package.json is ${appVersion} but latest release is ${latestRelease.tag}. Bumping from ${latestRelease.tag}.`,
      );
    }

    const initialReleaseNotes =
      latestRelease === null ? yield* readInitialReleaseNotes() : null;
    const dirtyStatus = yield* getDirtyStatus();
    yield* checkDirtyTree(
      dirtyStatus,
      input,
      latestRelease === null ? new Set([" M RELEASE_NOTES.md"]) : new Set(),
    );

    if (input.dryRun) {
      yield* printPlan(
        branch,
        latestRelease,
        appVersion,
        targetVersion,
        targetTag,
      );
      return;
    }

    yield* writeAppVersion(appPackageJson, targetVersion);
    if (initialReleaseNotes !== null) {
      yield* writeInitialChangelog(
        targetVersion,
        targetTag,
        initialReleaseNotes,
      );
      yield* resetInitialReleaseNotes();
      yield* Console.log(
        "Reset RELEASE_NOTES.md to its placeholder; it is not part of the release commit.",
      );
    } else {
      yield* runGitCliff(gitCliffChangelogArgs(targetTag));
    }
    yield* printNextCommands(targetVersion, targetTag);
  });

const command = Command.make("release", {
  bumpOrVersion: Argument.string("bump-or-version").pipe(
    Argument.withDescription("patch, minor, major, or a stable semver version"),
  ),
  dryRun: Flag.boolean("dry-run").pipe(
    Flag.withDescription("Print the release plan without writing files"),
    Flag.withDefault(false),
  ),
  allowDirty: Flag.boolean("allow-dirty").pipe(
    Flag.withDescription(
      "Allow release prep with existing working tree changes",
    ),
    Flag.withDefault(false),
  ),
}).pipe(
  Command.withDescription("Prepare a Lucent release from main"),
  Command.withHandler(release),
);

const getCliArgs = (): ReadonlyArray<string> =>
  process.argv.slice(2).filter((arg) => arg !== "--");

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  Command.runWith(command, {
    version: "1.0.0",
  })(getCliArgs()).pipe(
    Effect.catch((error) =>
      Effect.gen(function* () {
        yield* error instanceof ReleaseError
          ? Console.error(`Release failed: ${error.message}`)
          : Console.error(`Release failed: ${toErrorMessage(error)}`);
        process.exitCode = 1;
      }),
    ),
    Effect.provide(NodeServices.layer),
    NodeRuntime.runMain,
  );
}
