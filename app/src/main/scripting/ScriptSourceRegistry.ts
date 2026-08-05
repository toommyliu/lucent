import { extname, relative, resolve } from "path";

import { parse } from "acorn";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import type {
  ScriptFile,
  ScriptFileResolution,
} from "@lucent/core/scriptInputs";
import type {
  ScriptExecutionPackage,
  ScriptExecutionSnapshot,
  ScriptModuleSource,
  ScriptReference,
} from "@lucent/core/scriptPackages";
import {
  isRelativeScriptModuleSpecifier,
  resolveRelativeScriptModulePath,
  scriptModulePathCandidates,
} from "@lucent/core/scriptPackages";
import { ScriptFiles } from "../internal/scripting/ScriptFiles";
import {
  type DiscoveredScriptCatalog,
  type DiscoveredScriptPackage,
  ScriptPackageCatalog,
} from "./ScriptPackageCatalog";
import {
  isMissingFileError,
  portablePath,
  readStableFileWithFingerprint,
  regularFileFingerprint,
  SCRIPT_MODULE_MAX_BYTES,
  SCRIPT_SNAPSHOT_MAX_BYTES,
  sha256Revision,
} from "./ScriptPackageFileSystem";

const SNAPSHOT_MAX_ATTEMPTS = 3;
const SOURCE_CACHE_MAX_BYTES = 128 * 1024 * 1024;
const SOURCE_CACHE_MAX_ENTRIES = 1024;
const SOURCE_READ_CONCURRENCY = 8;

export class ScriptSourceRegistryError extends Schema.TaggedErrorClass<ScriptSourceRegistryError>()(
  "ScriptSourceRegistryError",
  {
    detail: Schema.String,
    path: Schema.optionalKey(Schema.String),
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {
  override get message(): string {
    return this.detail;
  }
}

export interface ScriptSourceRegistryShape {
  readonly readPath: (
    path: string,
  ) => Effect.Effect<ScriptFile, ScriptSourceRegistryError>;
  readonly readReference: (
    reference: ScriptReference,
  ) => Effect.Effect<ScriptFile, ScriptSourceRegistryError>;
  readonly resolvePath: (path: string) => Effect.Effect<ScriptFileResolution>;
  readonly resolveReference: (
    reference: ScriptReference,
  ) => Effect.Effect<ScriptFileResolution>;
}

export class ScriptSourceRegistry extends Context.Service<
  ScriptSourceRegistry,
  ScriptSourceRegistryShape
>()("lucent/desktop/scripting/ScriptSourceRegistry") {}

interface ModuleTarget {
  readonly absolutePath: string;
  readonly format: ScriptModuleSource["format"];
  readonly id: string;
  readonly packageName?: string;
  readonly path: string;
}

interface LoadedSource {
  readonly bytes: number;
  readonly fingerprint: string;
  readonly module: ScriptModuleSource;
  readonly requirements: readonly string[];
}

type CachedSource = LoadedSource;

interface ExecutionClosure {
  readonly modules: readonly ScriptModuleSource[];
  readonly packages: readonly ScriptExecutionPackage[];
}

const looseModuleId = (path: string): string => `loose:${path}`;
const packageModuleId = (packageName: string, path: string): string =>
  `package:${packageName}:${path}`;

const moduleFormat = (
  packageEntry: DiscoveredScriptPackage,
  path: string,
): ScriptModuleSource["format"] =>
  packageEntry.manifest.type === "module" &&
  extname(path).toLowerCase() === ".js"
    ? "unsupported-esm"
    : "commonjs";

const recordValue = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;

/** Finds only direct require calls with one string-literal argument. */
export const discoverLiteralScriptRequirements = (
  source: string,
): readonly string[] => {
  let root: unknown;
  try {
    root = parse(source, {
      allowHashBang: true,
      allowReturnOutsideFunction: true,
      ecmaVersion: "latest",
      sourceType: "script",
    });
  } catch {
    return [];
  }

  const requirements = new Set<string>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    const node = recordValue(value);
    if (node === undefined) return;
    if (node["type"] === "CallExpression") {
      const callee = recordValue(node["callee"]);
      const argumentsValue = node["arguments"];
      if (
        callee?.["type"] === "Identifier" &&
        callee["name"] === "require" &&
        Array.isArray(argumentsValue) &&
        argumentsValue.length === 1
      ) {
        const argument = recordValue(argumentsValue[0]);
        if (
          argument?.["type"] === "Literal" &&
          typeof argument["value"] === "string"
        ) {
          requirements.add(argument["value"]);
        }
      }
    }
    for (const child of Object.values(node)) visit(child);
  };
  visit(root);
  return [...requirements];
};

const looseTarget = (
  discovery: DiscoveredScriptCatalog,
  path: string,
): ModuleTarget | undefined => {
  const entry = discovery.scripts.get(`loose:${path}`);
  return entry === undefined
    ? undefined
    : {
        absolutePath: entry.path,
        format: "commonjs",
        id: looseModuleId(path),
        path,
      };
};

const packageTarget = (
  packageEntry: DiscoveredScriptPackage,
  path: string,
): ModuleTarget | undefined => {
  const absolutePath = packageEntry.modules.get(path);
  return absolutePath === undefined
    ? undefined
    : {
        absolutePath,
        format: moduleFormat(packageEntry, path),
        id: packageModuleId(packageEntry.name, path),
        packageName: packageEntry.name,
        path,
      };
};

const entryTarget = (
  discovery: DiscoveredScriptCatalog,
  reference: ScriptReference,
): ModuleTarget | undefined =>
  reference.kind === "loose"
    ? looseTarget(discovery, reference.path)
    : discovery.packages.get(reference.packageName) === undefined
      ? undefined
      : packageTarget(
          discovery.packages.get(reference.packageName)!,
          reference.path,
        );

const resolveRelativeTarget = (
  discovery: DiscoveredScriptCatalog,
  importer: ModuleTarget,
  specifier: string,
): ModuleTarget | undefined => {
  const normalized = resolveRelativeScriptModulePath(importer.path, specifier);
  if (normalized === null) return undefined;
  for (const candidate of scriptModulePathCandidates(normalized)) {
    const resolved =
      importer.packageName === undefined
        ? looseTarget(discovery, candidate)
        : discovery.packages.get(importer.packageName) === undefined
          ? undefined
          : packageTarget(
              discovery.packages.get(importer.packageName)!,
              candidate,
            );
    if (resolved !== undefined) return resolved;
  }
  return undefined;
};

const packageSnapshot = (
  packageEntry: DiscoveredScriptPackage,
): ScriptExecutionPackage => ({
  compatibility: packageEntry.compatibility,
  mainModuleId:
    packageEntry.mainPath === null
      ? null
      : packageModuleId(
          packageEntry.name,
          portablePath(relative(packageEntry.rootPath, packageEntry.mainPath)),
        ),
  name: packageEntry.name,
  rootPath: packageEntry.rootPath,
});

const errorMessage = (cause: unknown, fallback: string): string =>
  cause instanceof Error && cause.message.trim() !== ""
    ? cause.message
    : fallback;

const failedResolution = (
  path: string,
  cause: unknown,
): ScriptFileResolution => {
  const message = errorMessage(cause, "Script source preparation failed.");
  const detailsText = cause instanceof Error ? cause.stack : undefined;
  return {
    status: "failed",
    path,
    message,
    ...(detailsText === undefined ? {} : { detailsText }),
  };
};

export const layer = Layer.effect(
  ScriptSourceRegistry,
  Effect.gen(function* () {
    const catalog = yield* ScriptPackageCatalog;
    const scriptFiles = yield* ScriptFiles;
    const sourceCache = new Map<string, CachedSource>();
    let sourceCacheBytes = 0;

    const readModule = async (target: ModuleTarget): Promise<LoadedSource> => {
      const currentFingerprint = await regularFileFingerprint(
        target.absolutePath,
      );
      const cached = sourceCache.get(target.absolutePath);
      if (
        cached?.fingerprint === currentFingerprint &&
        cached.module.format === target.format &&
        cached.module.id === target.id
      ) {
        sourceCache.delete(target.absolutePath);
        sourceCache.set(target.absolutePath, cached);
        return cached;
      }

      const stable = await readStableFileWithFingerprint(
        target.absolutePath,
        SCRIPT_MODULE_MAX_BYTES,
      );
      const { contents } = stable;
      const module: ScriptModuleSource = {
        format: target.format,
        id: target.id,
        localPath: target.absolutePath,
        path: target.path,
        ...(target.packageName === undefined
          ? {}
          : { packageName: target.packageName }),
        revision: sha256Revision(contents),
        source: contents.toString("utf8"),
      };
      const next: CachedSource = {
        bytes: contents.byteLength,
        fingerprint: stable.fingerprint,
        module,
        requirements:
          target.format === "commonjs"
            ? discoverLiteralScriptRequirements(module.source)
            : [],
      };
      if (cached !== undefined) sourceCacheBytes -= cached.bytes;
      sourceCache.delete(target.absolutePath);
      sourceCache.set(target.absolutePath, next);
      sourceCacheBytes += next.bytes;
      while (
        sourceCacheBytes > SOURCE_CACHE_MAX_BYTES ||
        sourceCache.size > SOURCE_CACHE_MAX_ENTRIES
      ) {
        const oldestPath = sourceCache.keys().next().value;
        if (oldestPath === undefined) break;
        const oldest = sourceCache.get(oldestPath);
        sourceCache.delete(oldestPath);
        sourceCacheBytes -= oldest?.bytes ?? 0;
      }
      return next;
    };

    /** Reads only modules reachable through Lucent's literal CommonJS contract. */
    const collectExecutionClosure = async (
      discovery: DiscoveredScriptCatalog,
      selectedTarget: ModuleTarget,
      selectedFile: ScriptFile,
    ): Promise<ExecutionClosure | null> => {
      const modules = new Map<string, ScriptModuleSource>();
      const packages = new Map<string, ScriptExecutionPackage>();
      const fingerprints = new Map<string, string>();
      const scheduled = new Set([selectedTarget.id]);
      const queue: ModuleTarget[] = [selectedTarget];
      let totalBytes = 0;

      const schedule = (target: ModuleTarget | undefined): void => {
        if (target === undefined || scheduled.has(target.id)) return;
        scheduled.add(target.id);
        queue.push(target);
      };

      while (queue.length > 0) {
        const batch = queue.splice(0, SOURCE_READ_CONCURRENCY);
        const loadedBatch = await Promise.all(
          batch.map(async (target) => {
            if (target.id === selectedTarget.id) {
              const module: ScriptModuleSource = {
                format: target.format,
                id: target.id,
                localPath: target.absolutePath,
                path: target.path,
                ...(target.packageName === undefined
                  ? {}
                  : { packageName: target.packageName }),
                revision: selectedFile.revision,
                source: selectedFile.source,
              };
              return {
                target,
                loaded: {
                  bytes: Buffer.byteLength(selectedFile.source, "utf8"),
                  fingerprint: "",
                  module,
                  requirements:
                    target.format === "commonjs"
                      ? discoverLiteralScriptRequirements(selectedFile.source)
                      : [],
                } satisfies LoadedSource,
              };
            }
            try {
              return { target, loaded: await readModule(target) };
            } catch (cause) {
              if (isMissingFileError(cause)) return { target, loaded: null };
              throw cause;
            }
          }),
        );

        for (const { loaded, target } of loadedBatch) {
          if (loaded === null) continue;
          modules.set(target.id, loaded.module);
          if (target.id !== selectedTarget.id) {
            fingerprints.set(target.absolutePath, loaded.fingerprint);
          }
          totalBytes += loaded.bytes;
          if (totalBytes > SCRIPT_SNAPSHOT_MAX_BYTES) {
            throw new Error(
              `Script sources exceed the ${SCRIPT_SNAPSHOT_MAX_BYTES} byte execution limit.`,
            );
          }

          for (const specifier of loaded.requirements) {
            if (specifier === "lucent" || specifier === "effect") continue;
            if (isRelativeScriptModuleSpecifier(specifier)) {
              schedule(resolveRelativeTarget(discovery, target, specifier));
              continue;
            }

            const packageEntry = discovery.packages.get(specifier);
            if (packageEntry === undefined) continue;
            packages.set(packageEntry.name, packageSnapshot(packageEntry));
            if (
              packageEntry.compatibility.status === "incompatible" ||
              packageEntry.mainPath === null
            ) {
              continue;
            }
            schedule(
              packageTarget(
                packageEntry,
                portablePath(
                  relative(packageEntry.rootPath, packageEntry.mainPath),
                ),
              ),
            );
          }
        }
      }

      const fingerprintEntries = [...fingerprints];
      for (
        let index = 0;
        index < fingerprintEntries.length;
        index += SOURCE_READ_CONCURRENCY
      ) {
        const batch = fingerprintEntries.slice(
          index,
          index + SOURCE_READ_CONCURRENCY,
        );
        let current: readonly string[];
        try {
          current = await Promise.all(
            batch.map(([path]) => regularFileFingerprint(path)),
          );
        } catch (cause) {
          if (isMissingFileError(cause)) return null;
          throw cause;
        }
        if (
          current.some(
            (fingerprint, batchIndex) => fingerprint !== batch[batchIndex]?.[1],
          )
        ) {
          return null;
        }
      }

      return {
        modules: [...modules.values()].toSorted((left, right) =>
          left.id.localeCompare(right.id),
        ),
        packages: [...packages.values()].toSorted((left, right) =>
          left.name.localeCompare(right.name),
        ),
      };
    };

    const readReference = Effect.fn("ScriptSourceRegistry.readReference")(
      function* (reference: ScriptReference) {
        for (let attempt = 0; attempt < SNAPSHOT_MAX_ATTEMPTS; attempt += 1) {
          const discovery = yield* catalog.getDiscovery.pipe(
            Effect.mapError(
              (cause) =>
                new ScriptSourceRegistryError({
                  detail: cause.message,
                  cause,
                }),
            ),
          );
          const entry = discovery.scripts.get(
            reference.kind === "loose"
              ? `loose:${reference.path}`
              : `package:${reference.packageName}:${reference.path}`,
          );
          if (entry === undefined) {
            return yield* new ScriptSourceRegistryError({
              detail: "The selected script is no longer available.",
            });
          }

          if (reference.kind === "package") {
            const owner = discovery.packages.get(reference.packageName);
            if (owner?.compatibility.status === "incompatible") {
              return yield* new ScriptSourceRegistryError({
                detail: `${owner.name} requires Lucent ${owner.compatibility.requiredVersion}; this app is ${owner.compatibility.currentVersion}.`,
                path: entry.path,
              });
            }
          }
          const target = entryTarget(discovery, reference);
          if (target === undefined) continue;
          const parsedEntry = yield* scriptFiles.read(entry.path).pipe(
            Effect.mapError(
              (cause) =>
                new ScriptSourceRegistryError({
                  detail: cause.message,
                  path: entry.path,
                  cause,
                }),
            ),
          );
          const closure = yield* Effect.tryPromise({
            try: () => collectExecutionClosure(discovery, target, parsedEntry),
            catch: (cause) =>
              new ScriptSourceRegistryError({
                detail: errorMessage(
                  cause,
                  "Failed to read reachable script sources.",
                ),
                path: entry.path,
                cause,
              }),
          });
          if (closure === null) continue;
          const verifiedEntry = yield* scriptFiles.read(entry.path).pipe(
            Effect.mapError(
              (cause) =>
                new ScriptSourceRegistryError({
                  detail: cause.message,
                  path: entry.path,
                  cause,
                }),
            ),
          );
          if (verifiedEntry.revision !== parsedEntry.revision) continue;

          const snapshotRevision = sha256Revision(
            JSON.stringify({
              entryId: target.id,
              modules: closure.modules.map(({ id, revision }) => ({
                id,
                revision,
              })),
              packages: closure.packages,
            }),
          );
          const snapshot: ScriptExecutionSnapshot = {
            entryModuleId: target.id,
            modules: closure.modules,
            packages: closure.packages,
            revision: snapshotRevision,
          };
          return {
            ...verifiedEntry,
            name: entry.name,
            path: entry.path,
            reference,
            snapshot,
          } satisfies ScriptFile;
        }

        return yield* new ScriptSourceRegistryError({
          detail:
            "Script files kept changing while Lucent prepared an execution snapshot. Try starting again.",
        });
      },
    );

    const readPath: ScriptSourceRegistryShape["readPath"] = (path) =>
      catalog.referenceForPath(path).pipe(
        Effect.mapError(
          (cause) =>
            new ScriptSourceRegistryError({
              detail: cause.message,
              path,
              cause,
            }),
        ),
        Effect.flatMap((reference) =>
          reference === undefined
            ? scriptFiles.read(path).pipe(
                Effect.mapError(
                  (cause) =>
                    new ScriptSourceRegistryError({
                      detail: cause.message,
                      path,
                      cause,
                    }),
                ),
              )
            : readReference(reference),
        ),
      );

    const resolveReference: ScriptSourceRegistryShape["resolveReference"] = (
      reference,
    ) => {
      const displayPath =
        reference.kind === "loose"
          ? reference.path
          : `${reference.packageName}/${reference.path}`;
      return catalog.resolveReference(reference).pipe(
        Effect.flatMap((entry) =>
          entry === undefined
            ? Effect.succeed({
                status: "missing",
                path: displayPath,
              } satisfies ScriptFileResolution)
            : readReference(reference).pipe(
                Effect.match({
                  onFailure: (cause) => failedResolution(displayPath, cause),
                  onSuccess: (file) =>
                    ({
                      status: "found",
                      file,
                    }) satisfies ScriptFileResolution,
                }),
              ),
        ),
        Effect.catch((cause) =>
          Effect.succeed(failedResolution(displayPath, cause)),
        ),
      );
    };

    const resolvePath: ScriptSourceRegistryShape["resolvePath"] = (path) =>
      catalog.referenceForPath(path).pipe(
        Effect.flatMap((reference) =>
          reference === undefined
            ? scriptFiles.resolve(path)
            : resolveReference(reference),
        ),
        Effect.catch((cause) =>
          Effect.succeed(failedResolution(resolve(path), cause)),
        ),
      );

    return ScriptSourceRegistry.of({
      readPath,
      readReference,
      resolvePath,
      resolveReference,
    });
  }),
);
