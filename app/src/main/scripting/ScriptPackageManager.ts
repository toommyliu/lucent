import { pathExists } from "../filesystem/BoundedFileSystem";
import { basename, dirname, join } from "node:path";

import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { FileSystem } from "effect/FileSystem";
import { nativeCause } from "../filesystem/BoundedFileSystem";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import type {
  ScriptCatalogOverview,
  ScriptPackageDirectory,
  ScriptPackageMutationResult,
  ScriptPackageName,
  ScriptPackageIntegrity,
  ScriptPackageRevision,
  ScriptPackageUpdateState,
} from "@lucent/core/scriptPackages";
import { ScriptPackageDirectorySchema } from "@lucent/core/scriptPackages";
import { DesktopEnvironment } from "../app/DesktopEnvironment";
import { logFailure } from "../../shared/logFailure";
import {
  GitHubScriptPackageClient,
  type GitHubScriptPackageClientError,
  normalizeGitHubRepositoryUrl,
} from "./GitHubScriptPackageClient";
import { extractScriptPackageArchive } from "./ScriptPackageArchive";
import {
  inspectScriptPackageDirectory,
  inspectManagedPackageFolder,
  integrityFor,
  logScriptPackageInspectionFailures,
} from "./ScriptPackageInspection";
import { ScriptPackageCatalog } from "./ScriptPackageCatalog";
import type { ScriptPackageCatalogReplacement } from "./ScriptCatalogDiscovery";
import { hashDirectory, isPathInside } from "./ScriptPackageFileSystem";
import { copyBundledScriptPackage } from "./ScriptPackageFileSystem";
import {
  allocatePackageDirectory,
  packageDirectoryPath,
} from "./ScriptPackageDirectories";
import {
  ScriptPackageState,
  ManagedScriptPackageSchema,
  type ManagedScriptPackage,
} from "./ScriptPackageState";
import { resolveScriptWorkspacePaths } from "./ScriptWorkspacePaths";

const decodePackageDirectory = Schema.decodeUnknownSync(
  ScriptPackageDirectorySchema,
);

const managedPackagesEquivalent = Schema.toEquivalence(
  ManagedScriptPackageSchema,
);

const packageManagerOperationSchema = Schema.Literals([
  "check-update",
  "extract",
  "install",
  "remove",
  "replace",
  "restore",
  "update",
  "validate",
]);

export class ScriptPackageManagerError extends Schema.TaggedError<ScriptPackageManagerError>()(
  "ScriptPackageManagerError",
  {
    operation: packageManagerOperationSchema,
    detail: Schema.String,
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {
  override get message(): string {
    return this.detail;
  }
}

export interface ScriptPackageManagerShape {
  readonly checkUpdate: (input: {
    readonly packageName: string;
  }) => Effect.Effect<ScriptCatalogOverview, ScriptPackageManagerError>;
  readonly install: (input: {
    readonly credentialId?: string;
    readonly ref?: string;
    readonly replaceExisting?: boolean;
    readonly repositoryUrl: string;
    readonly subdirectory?: string;
  }) => Effect.Effect<ScriptPackageMutationResult, ScriptPackageManagerError>;
  readonly remove: (input: {
    readonly confirmModified?: boolean;
    readonly packageName: string;
  }) => Effect.Effect<ScriptPackageMutationResult, ScriptPackageManagerError>;
  readonly restore: (input: {
    readonly packageName: string;
  }) => Effect.Effect<ScriptPackageMutationResult, ScriptPackageManagerError>;
  readonly update: (input: {
    readonly packageName: string;
    readonly replaceModified?: boolean;
  }) => Effect.Effect<ScriptPackageMutationResult, ScriptPackageManagerError>;
}

export class ScriptPackageManager extends Context.Service<
  ScriptPackageManager,
  ScriptPackageManagerShape
>()("lucent/desktop/scripting/ScriptPackageManager") {}

interface ResolvedPackageRevision {
  readonly checkedAt: string;
  readonly revision: ScriptPackageRevision;
  readonly commitLookup?: ManagedScriptPackage["commitLookup"];
}

interface ResolvedInstallSource extends ResolvedPackageRevision {
  readonly commit: string;
}

type PackageOperation = "install" | "update" | "restore";

interface GitHubOrigin {
  readonly repositoryUrl: string;
  readonly credentialId?: string;
  readonly requestedRef?: string;
  readonly subdirectory?: string;
}

type PackageSource =
  | {
      readonly kind: "github";
      readonly repositoryUrl: string;
      readonly commit: string;
      readonly credentialId?: string;
      readonly subdirectory?: string;
    }
  | {
      readonly kind: "bundled";
      readonly path: string;
      readonly tree: string;
    };

type PackageTarget =
  | { readonly kind: "new"; readonly replaceExisting: boolean }
  | {
      readonly kind: "replace";
      readonly installed: ManagedScriptPackage;
      readonly root: string;
      readonly requireUnmodified: boolean;
    };

type PackageDetails = Pick<
  ManagedScriptPackage,
  "commitLookup" | "source" | "update"
>;

const BUNDLED_COPY_UNAVAILABLE =
  "The installed bundled copy is not available in this app. Check for updates, then use Update to install the latest version.";

const githubSource = (origin: GitHubOrigin, commit: string): PackageSource => ({
  kind: "github",
  repositoryUrl: origin.repositoryUrl,
  commit,
  ...(origin.credentialId === undefined
    ? {}
    : { credentialId: origin.credentialId }),
  ...(origin.subdirectory === undefined
    ? {}
    : { subdirectory: origin.subdirectory }),
});

const remoteDetails = (
  origin: GitHubOrigin,
  resolution: ResolvedInstallSource,
): PackageDetails => {
  const shared = {
    repositoryUrl: origin.repositoryUrl,
    resolvedCommit: resolution.commit,
    ...(origin.credentialId === undefined
      ? {}
      : { credentialId: origin.credentialId }),
    ...(origin.requestedRef === undefined
      ? {}
      : { requestedRef: origin.requestedRef }),
  };
  return {
    source:
      origin.subdirectory === undefined
        ? { kind: "repository", ...shared }
        : {
            kind: "directory",
            ...shared,
            resolvedTree: resolution.revision.sha,
            subdirectory: origin.subdirectory,
          },
    update: { status: "current", checkedAt: resolution.checkedAt },
    ...(resolution.commitLookup === undefined
      ? {}
      : { commitLookup: resolution.commitLookup }),
  };
};

const installedRevision = (
  managed: ManagedScriptPackage,
): ScriptPackageRevision =>
  managed.source.kind === "repository"
    ? { kind: "commit", sha: managed.source.resolvedCommit }
    : { kind: "tree", sha: managed.source.resolvedTree };

const revisionsMatch = (
  left: ScriptPackageRevision,
  right: ScriptPackageRevision,
): boolean => left.kind === right.kind && left.sha === right.sha;

const recordRemoteResolution = (
  managed: ManagedScriptPackage,
  resolution: ResolvedPackageRevision,
): ManagedScriptPackage => ({
  directory: managed.directory,
  files: managed.files,
  installedAt: managed.installedAt,
  name: managed.name,
  source: managed.source,
  update: revisionsMatch(resolution.revision, installedRevision(managed))
    ? { status: "current", checkedAt: resolution.checkedAt }
    : {
        status: "available",
        checkedAt: resolution.checkedAt,
        revision: resolution.revision,
      },
  ...(resolution.commitLookup === undefined
    ? {}
    : { commitLookup: resolution.commitLookup }),
});

const rateLimitedState = (
  error: GitHubScriptPackageClientError,
): ScriptPackageUpdateState | undefined =>
  error.kind === "rate-limited" && error.retryAt !== undefined
    ? {
        status: "rate-limited",
        message: "GitHub's request limit has been reached.",
        retryAt: error.retryAt,
      }
    : undefined;

const managerError = (
  operation: typeof packageManagerOperationSchema.Type,
  detail: string,
  cause?: unknown,
) =>
  new ScriptPackageManagerError({
    operation,
    detail,
    ...(cause === undefined ? {} : { cause: nativeCause(cause) }),
  });

const localModifications = (
  packageName: string,
): ScriptPackageMutationResult => ({
  status: "confirmation-required",
  packageName,
  reason: "local-modifications",
});

export const layer = Layer.effect(
  ScriptPackageManager,
  Effect.gen(function* () {
    const catalog = yield* ScriptPackageCatalog;
    const client = yield* GitHubScriptPackageClient;
    const env = yield* DesktopEnvironment;
    const fileSystem = yield* FileSystem;
    const movePath = fileSystem.rename;
    const state = yield* ScriptPackageState;
    const { packagesDir } = resolveScriptWorkspacePaths(env.workspaceDir);
    const mutationGate = yield* Semaphore.make(1);

    const inspectIntegrity = Effect.fnUntraced(
      function* (rootPath: string, managed: ManagedScriptPackage | undefined) {
        const check = yield* integrityFor(rootPath, managed);
        if (check.failure !== undefined)
          yield* logScriptPackageInspectionFailures([check.failure]);
        return check.integrity;
      },
      Effect.provideService(FileSystem, fileSystem),
    );

    const mapCatalogError = (cause: unknown) =>
      managerError("validate", "Failed to update the script catalog.", cause);

    const refreshPackageIntegrity = Effect.fnUntraced(
      function* (
        name: string,
        rootPath: string,
        integrity: ScriptPackageIntegrity,
      ) {
        const managed = yield* state.get(name);
        if (managed === undefined) return yield* catalog.refresh;
        const inspected = yield* inspectManagedPackageFolder(
          packagesDir,
          rootPath,
          managed,
        ).pipe(Effect.orElseSucceed(() => undefined));
        if (inspected === undefined) return yield* catalog.refresh;
        return yield* catalog.replacePackage({
          inspected,
          integrity,
          managed,
          rootPath,
          sourceRoot: rootPath,
        });
      },
      Effect.provideService(FileSystem, fileSystem),
    );

    const resolveSource = Effect.fn("ScriptPackageManager.resolveSource")(
      function* (input: {
        readonly repositoryUrl: string;
        readonly credentialId?: string;
        readonly ref?: string;
        readonly subdirectory?: string;
        readonly known?: ManagedScriptPackage["commitLookup"];
      }) {
        const commit = yield* client.resolveCommit({
          repositoryUrl: input.repositoryUrl,
          ...(input.credentialId === undefined
            ? {}
            : { credentialId: input.credentialId }),
          ...(input.ref === undefined ? {} : { ref: input.ref }),
          ...(input.known === undefined ? {} : { known: input.known }),
        });
        if (input.subdirectory === undefined) {
          return {
            checkedAt: (yield* DateTime.nowAsDate).toISOString(),
            commit: commit.commit,
            revision: { kind: "commit", sha: commit.commit },
            ...(commit.etag === undefined
              ? {}
              : { commitLookup: { etag: commit.etag, commit: commit.commit } }),
          } satisfies ResolvedInstallSource;
        }
        const directory = yield* client.resolveDirectory({
          repositoryUrl: input.repositoryUrl,
          ref: commit.commit,
          subdirectory: input.subdirectory,
          ...(input.credentialId === undefined
            ? {}
            : { credentialId: input.credentialId }),
        });
        return {
          checkedAt: (yield* DateTime.nowAsDate).toISOString(),
          commit: commit.commit,
          revision: { kind: "tree", sha: directory.tree },
        } satisfies ResolvedInstallSource;
      },
    );

    const replacePackage = Effect.fn("ScriptPackageManager.replacePackage")(
      function* (
        replacement: ScriptPackageCatalogReplacement,
        expected?: ManagedScriptPackage,
      ): Effect.fn.Return<
        ScriptPackageMutationResult,
        ScriptPackageManagerError
      > {
        const {
          managed,
          rootPath: destination,
          sourceRoot: staging,
        } = replacement;
        const publish = catalog.replacePackage(replacement).pipe(
          Effect.mapError(mapCatalogError),
          Effect.map(
            (nextCatalog): ScriptPackageMutationResult => ({
              status: "completed",
              catalog: nextCatalog,
              packageName: managed.name,
            }),
          ),
        );
        const destinationExists = yield* pathExists(destination).pipe(
          Effect.mapError((cause) =>
            managerError(
              "replace",
              "Failed to inspect the package destination.",
              cause,
            ),
          ),
        );
        yield* fileSystem
          .makeDirectory(dirname(destination), { recursive: true })
          .pipe(
            Effect.mapError((cause) =>
              managerError(
                "replace",
                "Failed to replace the package directory.",
                cause,
              ),
            ),
          );

        if (!destinationExists) {
          yield* movePath(staging, destination).pipe(
            Effect.mapError((cause) =>
              managerError(
                "replace",
                "Failed to replace the package directory.",
                cause,
              ),
            ),
          );
          yield* state
            .save(managed)
            .pipe(
              Effect.catch((cause) =>
                movePath(destination, staging).pipe(
                  Effect.ignore,
                  Effect.andThen(
                    managerError(
                      "replace",
                      `Failed to save package installation state. Check ${destination}.`,
                      cause,
                    ),
                  ),
                ),
              ),
            );
          return yield* publish;
        }

        if (
          expected !== undefined &&
          (yield* inspectIntegrity(destination, expected)) !== "verified"
        ) {
          yield* refreshPackageIntegrity(
            expected.name,
            destination,
            "modified",
          ).pipe(Effect.mapError(mapCatalogError));
          return localModifications(expected.name);
        }
        const backupRoot = yield* fileSystem
          .makeTempDirectory({
            directory: env.workspaceDir,
            prefix: ".lucent-package-backup-",
          })
          .pipe(
            Effect.mapError((cause) =>
              managerError(
                "replace",
                "Failed to prepare the package backup.",
                cause,
              ),
            ),
          );
        const backup = join(backupRoot, basename(destination));
        const discardBackup = fileSystem
          .remove(backupRoot, { recursive: true, force: true })
          .pipe(
            Effect.catch((cause) =>
              Effect.logWarning(
                "Failed to delete the package backup",
                Cause.fail(cause),
              ).pipe(
                Effect.annotateLogs({
                  component: "script-packages",
                  data: { path: backupRoot },
                }),
              ),
            ),
          );
        yield* movePath(destination, backup).pipe(
          Effect.catch((cause) =>
            discardBackup.pipe(
              Effect.andThen(
                managerError(
                  "replace",
                  `Failed to move the previous package. Check ${destination}.`,
                  cause,
                ),
              ),
            ),
          ),
        );
        yield* movePath(staging, destination).pipe(
          Effect.andThen(
            state
              .save(managed)
              .pipe(
                Effect.tapError(() =>
                  fileSystem
                    .remove(destination, { recursive: true, force: true })
                    .pipe(Effect.ignore),
                ),
              ),
          ),
          Effect.catch(
            Effect.fnUntraced(function* (cause) {
              yield* movePath(backup, destination).pipe(
                Effect.mapError(() =>
                  managerError(
                    "replace",
                    `Failed to replace the package. The previous package remains at ${backup}. Check ${destination}.`,
                    cause,
                  ),
                ),
              );
              yield* discardBackup;
              return yield* managerError(
                "replace",
                `Failed to replace the package. The previous package was restored at ${destination}.`,
                cause,
              );
            }),
          ),
        );
        yield* discardBackup;
        return yield* publish;
      },
      Effect.uninterruptible,
    );

    const stagePackage = Effect.fn("ScriptPackageManager.stagePackage")(
      function* (
        operation: PackageOperation,
        source: PackageSource,
        temporaryRoot: string,
      ) {
        const staging = join(temporaryRoot, "package");
        if (source.kind === "bundled") {
          const snapshot = yield* copyBundledScriptPackage(
            source.path,
            staging,
          ).pipe(
            Effect.mapError((cause) =>
              managerError(operation, BUNDLED_COPY_UNAVAILABLE, cause),
            ),
          );
          if (snapshot.tree !== source.tree)
            return yield* managerError(operation, BUNDLED_COPY_UNAVAILABLE);
          const inspected = yield* inspectScriptPackageDirectory(staging).pipe(
            Effect.mapError((cause) =>
              managerError(
                operation,
                "The bundled copy is not a valid script package.",
                cause,
              ),
            ),
          );
          return { staging, inspected, files: snapshot.files };
        }

        const { subdirectory } = source;
        const archive = join(temporaryRoot, "repository.tgz");
        yield* client
          .downloadArchive({
            repositoryUrl: source.repositoryUrl,
            ref: source.commit,
            targetPath: archive,
            ...(source.credentialId === undefined
              ? {}
              : { credentialId: source.credentialId }),
          })
          .pipe(
            Effect.mapError((cause) =>
              managerError(
                operation,
                operation === "restore" && cause.kind === "not-found"
                  ? "GitHub could not provide the installed commit. Check repository access. Check for updates, then use Update to install the latest version."
                  : cause.message,
                cause,
              ),
            ),
          );
        yield* extractScriptPackageArchive(archive, staging, subdirectory).pipe(
          Effect.mapError((cause) =>
            managerError(
              "extract",
              subdirectory === undefined
                ? "The GitHub archive is not a safe script package."
                : "The selected package directory could not be safely extracted.",
              cause,
            ),
          ),
        );
        const inspected = yield* inspectScriptPackageDirectory(staging).pipe(
          Effect.mapError((cause) =>
            managerError(
              "validate",
              subdirectory === undefined
                ? "The repository root is not a valid script package."
                : "The selected package directory is not a valid script package.",
              cause,
            ),
          ),
        );
        const files = yield* hashDirectory(staging).pipe(
          Effect.mapError((cause) =>
            managerError(
              "validate",
              "Failed to hash the staged package.",
              cause,
            ),
          ),
        );
        return { staging, inspected, files };
      },
      Effect.provideService(FileSystem, fileSystem),
    );

    const newPackageDirectory = Effect.fn(
      "ScriptPackageManager.newPackageDirectory",
    )(
      function* (packageName: ScriptPackageName) {
        const installed = yield* catalog
          .locate(packageName)
          .pipe(
            Effect.mapError((cause) =>
              managerError(
                "validate",
                "Failed to inspect installed packages.",
                cause,
              ),
            ),
          );
        const folderError = (cause: unknown) =>
          managerError("validate", "Failed to choose a package folder.", cause);
        switch (installed.kind) {
          case "ambiguous":
            return yield* managerError(
              "validate",
              `More than one package folder declares the name ${JSON.stringify(packageName)}.`,
            );
          case "managed":
            return { directory: installed.managed.directory, absent: false };
          case "unmanaged":
            return { directory: installed.directory, absent: false };
          case "invalid":
            return {
              directory: yield* Effect.try({
                try: () => decodePackageDirectory(basename(installed.root)),
                catch: folderError,
              }),
              absent: false,
            };
          case "absent":
            return {
              directory: yield* allocatePackageDirectory(
                packagesDir,
                packageName,
                new Set((yield* state.getAll).map((entry) => entry.directory)),
              ).pipe(Effect.mapError(folderError)),
              absent: true,
            };
          default:
            return installed satisfies never;
        }
      },
      Effect.provideService(FileSystem, fileSystem),
    );

    const installPackage = Effect.fn("ScriptPackageManager.installPackage")(
      function* (
        operation: PackageOperation,
        source: PackageSource,
        target: PackageTarget,
        details: PackageDetails,
      ) {
        if (target.kind === "new") {
          yield* fileSystem
            .makeDirectory(packagesDir, { recursive: true })
            .pipe(
              Effect.mapError((cause) =>
                managerError(
                  operation,
                  "Failed to create the package directory.",
                  cause,
                ),
              ),
            );
        }
        return yield* Effect.acquireUseRelease(
          fileSystem
            .makeTempDirectory({
              directory: env.workspaceDir,
              prefix: ".lucent-package-install-",
            })
            .pipe(
              Effect.mapError((cause) =>
                managerError(
                  operation,
                  "Failed to create package staging.",
                  cause,
                ),
              ),
            ),
          (temporaryRoot) =>
            Effect.gen(function* () {
              const { staging, inspected, files } = yield* stagePackage(
                operation,
                source,
                temporaryRoot,
              );
              const name = inspected.manifest.name;
              let directory: ScriptPackageDirectory;
              let destination: string;
              if (target.kind === "replace") {
                if (name !== target.installed.name) {
                  return yield* managerError(
                    operation,
                    `The downloaded package declares ${JSON.stringify(name)} instead of ${JSON.stringify(target.installed.name)}.`,
                  );
                }
                directory = target.installed.directory;
                destination = target.root;
              } else {
                const chosen = yield* newPackageDirectory(name);
                directory = chosen.directory;
                destination = packageDirectoryPath(packagesDir, directory);
                const destinationExists = yield* pathExists(destination).pipe(
                  Effect.mapError((cause) =>
                    managerError(
                      "validate",
                      "Failed to inspect the package destination.",
                      cause,
                    ),
                  ),
                );
                if (destinationExists && chosen.absent) {
                  return yield* managerError(
                    "validate",
                    `Package folder ${JSON.stringify(directory)} is already in use.`,
                  );
                }
                if (destinationExists && !target.replaceExisting) {
                  return {
                    status: "confirmation-required",
                    packageName: name,
                    reason: "existing-package",
                  } satisfies ScriptPackageMutationResult;
                }
              }
              return yield* replacePackage(
                {
                  inspected,
                  managed: {
                    ...details,
                    name,
                    directory,
                    files,
                    installedAt: (yield* DateTime.nowAsDate).toISOString(),
                  },
                  rootPath: destination,
                  sourceRoot: staging,
                },
                target.kind === "replace" && target.requireUnmodified
                  ? target.installed
                  : undefined,
              );
            }),
          (temporaryRoot) =>
            fileSystem
              .remove(temporaryRoot, { recursive: true, force: true })
              .pipe(Effect.ignore),
        );
      },
      Effect.provideService(FileSystem, fileSystem),
    );

    const install: ScriptPackageManagerShape["install"] = (input) =>
      mutationGate.withPermits(1)(
        Effect.gen(function* () {
          const repository = yield* Effect.try({
            try: () => normalizeGitHubRepositoryUrl(input.repositoryUrl),
            catch: (cause) =>
              managerError(
                "install",
                "Enter a valid GitHub.com repository URL.",
                cause,
              ),
          });
          const requestedRef = input.ref?.trim();
          const origin: GitHubOrigin = {
            repositoryUrl: repository.url,
            ...(input.credentialId === undefined
              ? {}
              : { credentialId: input.credentialId }),
            ...(requestedRef ? { requestedRef } : {}),
            ...(input.subdirectory === undefined
              ? {}
              : { subdirectory: input.subdirectory }),
          };
          const resolution = yield* resolveSource({
            ...origin,
            ...(input.ref === undefined ? {} : { ref: input.ref }),
          }).pipe(
            Effect.mapError((cause) =>
              managerError("install", cause.message, cause),
            ),
          );
          return yield* installPackage(
            "install",
            githubSource(origin, resolution.commit),
            { kind: "new", replaceExisting: input.replaceExisting === true },
            remoteDetails(origin, resolution),
          );
        }),
      );

    const update: ScriptPackageManagerShape["update"] = (input) =>
      mutationGate.withPermits(1)(
        Effect.gen(function* () {
          const installed = yield* catalog
            .locate(input.packageName)
            .pipe(
              Effect.mapError((cause) =>
                managerError(
                  "update",
                  "Failed to inspect installed packages.",
                  cause,
                ),
              ),
            );
          switch (installed.kind) {
            case "ambiguous":
              return yield* managerError(
                "update",
                `More than one package folder declares the name ${JSON.stringify(input.packageName)}.`,
              );
            case "absent":
            case "invalid":
              return yield* managerError(
                "update",
                `Package ${JSON.stringify(input.packageName)} is not installed.`,
              );
            case "unmanaged":
              return yield* managerError(
                "update",
                "This package is unmanaged and has no GitHub source to update.",
              );
            case "managed":
              break;
            default:
              return installed satisfies never;
          }
          const { managed, root: savedRoot, summary } = installed;
          if (summary?.status !== "valid") {
            return yield* managerError(
              "update",
              `Package ${JSON.stringify(input.packageName)} is not installed.`,
            );
          }
          const resolution = yield* resolveSource({
            ...managed.source,
            ...(managed.source.requestedRef === undefined
              ? {}
              : { ref: managed.source.requestedRef }),
            known: managed.commitLookup,
          }).pipe(
            Effect.catch(
              Effect.fnUntraced(function* (cause) {
                const rateLimited = rateLimitedState(cause);
                if (rateLimited !== undefined) {
                  const next = { ...managed, update: rateLimited };
                  yield* state.save(next).pipe(
                    Effect.andThen(catalog.updateManagedPackage(next)),
                    Effect.catch((error) =>
                      Effect.logWarning(
                        "Failed to save the package rate limit",
                        Cause.fail(error),
                      ).pipe(
                        Effect.annotateLogs({
                          component: "script-packages",
                          data: { packageName: managed.name },
                        }),
                      ),
                    ),
                  );
                }
                return yield* managerError("update", cause.message, cause);
              }),
            ),
          );
          const observed = recordRemoteResolution(managed, resolution);
          yield* state
            .save(observed)
            .pipe(
              Effect.mapError((cause) =>
                managerError(
                  "update",
                  "Failed to save the package update state.",
                  cause,
                ),
              ),
            );
          const integrity = yield* inspectIntegrity(savedRoot, managed);
          const nextCatalog = yield* (
            integrity === summary.integrity
              ? catalog.updateManagedPackage(observed)
              : refreshPackageIntegrity(managed.name, savedRoot, integrity)
          ).pipe(Effect.mapError(mapCatalogError));
          if (integrity !== "verified" && input.replaceModified !== true) {
            return localModifications(input.packageName);
          }
          if (
            integrity === "verified" &&
            revisionsMatch(resolution.revision, installedRevision(managed))
          ) {
            return {
              status: "unchanged",
              catalog: nextCatalog,
              packageName: input.packageName,
            } satisfies ScriptPackageMutationResult;
          }
          return yield* installPackage(
            "update",
            githubSource(managed.source, resolution.commit),
            {
              kind: "replace",
              installed: managed,
              root: savedRoot,
              requireUnmodified: input.replaceModified !== true,
            },
            remoteDetails(managed.source, resolution),
          );
        }),
      );

    const restore: ScriptPackageManagerShape["restore"] = (input) =>
      mutationGate.withPermits(1)(
        Effect.gen(function* () {
          const installed = yield* catalog
            .locate(input.packageName)
            .pipe(Effect.mapError(mapCatalogError));
          switch (installed.kind) {
            case "ambiguous":
              return yield* managerError(
                "restore",
                `More than one package folder declares the name ${JSON.stringify(input.packageName)}.`,
              );
            case "absent":
            case "invalid":
            case "unmanaged":
              return yield* managerError(
                "restore",
                "This package has no saved GitHub installation to restore.",
              );
            case "managed":
              break;
            default:
              return installed satisfies never;
          }
          const { managed } = installed;
          const source = managed.source;
          const restoreFrom = (packageSource: PackageSource) =>
            installPackage(
              "restore",
              packageSource,
              {
                kind: "replace",
                installed: managed,
                root: installed.root,
                requireUnmodified: false,
              },
              managed,
            );
          if (source.kind !== "bundled")
            return yield* restoreFrom(
              githubSource(source, source.resolvedCommit),
            );
          const bundledRoot = join(env.assetsDir, "..", "script-packages");
          const bundledPath = join(env.assetsDir, "..", source.subdirectory);
          if (!isPathInside(bundledRoot, bundledPath))
            return yield* managerError("restore", BUNDLED_COPY_UNAVAILABLE);
          return yield* restoreFrom({
            kind: "bundled",
            path: bundledPath,
            tree: source.resolvedTree,
          });
        }),
      );

    const remove: ScriptPackageManagerShape["remove"] = (input) =>
      mutationGate.withPermits(1)(
        Effect.gen(function* () {
          const installed = yield* catalog
            .locate(input.packageName)
            .pipe(
              Effect.mapError((cause) =>
                managerError(
                  "remove",
                  "Failed to inspect installed packages.",
                  cause,
                ),
              ),
            );
          switch (installed.kind) {
            case "ambiguous":
              return yield* managerError(
                "remove",
                `More than one package folder declares the name ${JSON.stringify(input.packageName)}.`,
              );
            case "absent":
            case "invalid":
              return yield* managerError(
                "remove",
                `Package ${JSON.stringify(input.packageName)} is not installed.`,
              );
            case "managed":
              if (installed.summary?.status !== "valid") {
                return yield* managerError(
                  "remove",
                  `Package ${JSON.stringify(input.packageName)} is not installed.`,
                );
              }
              break;
            case "unmanaged":
              break;
            default:
              return installed satisfies never;
          }
          const { root } = installed;
          const managed =
            installed.kind === "managed" ? installed.managed : undefined;
          if (input.confirmModified !== true && managed === undefined) {
            return localModifications(input.packageName);
          }
          return yield* Effect.gen(function* () {
            if (
              input.confirmModified !== true &&
              (yield* inspectIntegrity(root, managed)) !== "verified"
            ) {
              yield* refreshPackageIntegrity(
                input.packageName,
                root,
                "modified",
              ).pipe(Effect.mapError(mapCatalogError));
              return localModifications(input.packageName);
            }
            yield* state
              .remove(input.packageName)
              .pipe(
                Effect.mapError((cause) =>
                  managerError(
                    "remove",
                    "Failed to update package state.",
                    cause,
                  ),
                ),
              );
            yield* fileSystem.remove(root, { recursive: true }).pipe(
              Effect.catch(
                Effect.fnUntraced(function* (cause) {
                  yield* catalog.refresh.pipe(Effect.ignore);
                  return yield* managerError(
                    "remove",
                    `Failed to delete the package folder at ${root}. It is now unmanaged.`,
                    cause,
                  );
                }),
              ),
            );
            const nextCatalog = yield* catalog
              .removePackage(input.packageName)
              .pipe(Effect.mapError(mapCatalogError));
            return {
              status: "completed",
              catalog: nextCatalog,
              packageName: input.packageName,
            } satisfies ScriptPackageMutationResult;
          }).pipe(Effect.uninterruptible);
        }),
      );

    const checkUpdate: ScriptPackageManagerShape["checkUpdate"] = (input) =>
      Effect.gen(function* () {
        const managed = yield* state.get(input.packageName);
        if (managed === undefined) {
          return yield* managerError(
            "check-update",
            "This package is unmanaged and has no GitHub source to check.",
          );
        }
        const source = managed.source;
        const resolution: Effect.Effect<
          ResolvedPackageRevision,
          GitHubScriptPackageClientError
        > =
          source.kind !== "repository"
            ? client
                .resolveDirectory({
                  repositoryUrl: source.repositoryUrl,
                  subdirectory: source.subdirectory,
                  ...(source.credentialId === undefined
                    ? {}
                    : { credentialId: source.credentialId }),
                  ...(source.requestedRef === undefined
                    ? {}
                    : { ref: source.requestedRef }),
                })
                .pipe(
                  Effect.flatMap((directory) =>
                    DateTime.nowAsDate.pipe(
                      Effect.map(
                        (now): ResolvedPackageRevision => ({
                          checkedAt: now.toISOString(),
                          revision: { kind: "tree", sha: directory.tree },
                        }),
                      ),
                    ),
                  ),
                )
            : resolveSource({
                ...source,
                ...(source.requestedRef === undefined
                  ? {}
                  : { ref: source.requestedRef }),
                known: managed.commitLookup,
              });
        const result = yield* resolution.pipe(
          Effect.matchEffect({
            onFailure: (error) =>
              logFailure(
                "Failed to check script package updates",
                Cause.fail(error),
                { failure: "warning" },
              ).pipe(
                Effect.annotateLogs({
                  component: "script-packages",
                  repeatKey: error.kind,
                  data: {
                    packageName: managed.name,
                    category: error.kind,
                    ...(error.retryAt === undefined
                      ? {}
                      : { retryAt: error.retryAt }),
                  },
                }),
                Effect.as({ status: "failed", error } as const),
              ),
            onSuccess: (value) =>
              Effect.succeed({ status: "succeeded", value } as const),
          }),
        );

        const lastSuccessfulCheckAt =
          managed.update.status === "current" ||
          managed.update.status === "available" ||
          managed.update.status === "unknown"
            ? managed.update.checkedAt
            : undefined;
        const next: ManagedScriptPackage =
          result.status === "succeeded"
            ? recordRemoteResolution(managed, result.value)
            : {
                ...managed,
                update: rateLimitedState(result.error) ?? {
                  status: "unknown",
                  message: result.error.message,
                  ...(lastSuccessfulCheckAt === undefined
                    ? {}
                    : { checkedAt: lastSuccessfulCheckAt }),
                },
              };
        return yield* mutationGate.withPermits(1)(
          Effect.gen(function* () {
            const current = yield* state.get(input.packageName);
            if (
              current === undefined ||
              !managedPackagesEquivalent(current, managed)
            ) {
              return yield* catalog.getOverview.pipe(
                Effect.mapError(mapCatalogError),
              );
            }
            yield* state
              .save(next)
              .pipe(
                Effect.mapError((cause) =>
                  managerError(
                    "check-update",
                    "Failed to save update state.",
                    cause,
                  ),
                ),
              );
            return yield* catalog
              .updateManagedPackage(next)
              .pipe(Effect.mapError(mapCatalogError));
          }),
        );
      });

    return ScriptPackageManager.of({
      checkUpdate,
      install,
      remove,
      restore,
      update,
    });
  }),
);
