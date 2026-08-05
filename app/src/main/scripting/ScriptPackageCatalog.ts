import { promises as fs, type Dirent } from "fs";
import { basename, extname, join, relative, resolve } from "path";

import * as Cache from "effect/Cache";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import { satisfies, validRange } from "semver";

import type {
  ScriptCatalog,
  ScriptCatalogChange,
  ScriptCatalogEntry,
  ScriptCatalogOverview,
  ScriptCatalogPage,
  ScriptCatalogPageRequest,
  ScriptPackageCompatibility,
  ScriptPackageSummary,
  ScriptReference,
} from "@lucent/core/scriptPackages";
import {
  ScriptPackageNameSchema,
  ScriptRelativePathSchema,
} from "@lucent/core/scriptPackages";
import { DesktopEnvironment } from "../app/DesktopEnvironment";
import { makeListenerRegistry } from "../app/ListenerRegistry";
import { ElectronApp } from "../electron/ElectronApp";
import {
  hashDirectory,
  isMissingFileError,
  isPathInside,
  listRegularFilePaths,
  portablePath,
  SCRIPT_PACKAGE_MAX_FILES,
  sha256Revision,
} from "./ScriptPackageFileSystem";
import {
  ScriptPackageState,
  type ManagedScriptPackage,
} from "./ScriptPackageState";

const MANIFEST_MAX_BYTES = 1024 * 1024;
const NonEmptyManifestStringSchema = Schema.String.check(
  Schema.makeFilter((value) => value.trim() !== "", {
    expected: "a non-empty string",
  }),
);

const ScriptPackageManifestJsonSchema = Schema.Struct({
  name: NonEmptyManifestStringSchema,
  description: Schema.optionalKey(Schema.String),
  lucent: Schema.optionalKey(
    Schema.Struct({
      version: Schema.optionalKey(Schema.String),
    }),
  ),
  main: Schema.optionalKey(Schema.String),
  type: Schema.optionalKey(Schema.String),
  version: Schema.optionalKey(Schema.String),
});

const decodeManifestJson = Schema.decodeUnknownSync(
  ScriptPackageManifestJsonSchema,
);
const decodePackageName = Schema.decodeUnknownSync(ScriptPackageNameSchema);
const decodeRelativePath = Schema.decodeUnknownSync(ScriptRelativePathSchema);

/** Parses the manifest while keeping catalog diagnostics readable. */
const parseManifestJson = (
  source: string,
): typeof ScriptPackageManifestJsonSchema.Type => {
  let value: unknown;
  try {
    value = JSON.parse(source) as unknown;
  } catch {
    throw new Error("package.json contains invalid JSON.");
  }

  try {
    return decodeManifestJson(value);
  } catch {
    throw new Error("package.json contains invalid fields.");
  }
};

export interface ScriptPackageManifest {
  readonly description?: string;
  readonly lucentVersion?: string;
  readonly main: string;
  readonly name: string;
  readonly type?: string;
  readonly version?: string;
}

export interface DiscoveredScriptPackage {
  readonly compatibility: ScriptPackageCompatibility;
  readonly files: readonly string[];
  readonly mainPath: string | null;
  readonly manifest: ScriptPackageManifest;
  readonly modules: ReadonlyMap<string, string>;
  readonly name: string;
  readonly rootPath: string;
}

export interface InspectedScriptPackageDirectory {
  readonly files: readonly string[];
  readonly mainPath: string | null;
  readonly manifest: ScriptPackageManifest;
}

export interface DiscoveredScriptCatalog {
  readonly catalog: ScriptCatalog;
  readonly paths: ReadonlyMap<string, ScriptReference>;
  readonly packages: ReadonlyMap<string, DiscoveredScriptPackage>;
  readonly scripts: ReadonlyMap<string, ScriptCatalogEntry>;
}

export interface ScriptPackageCatalogReplacement {
  readonly inspected: InspectedScriptPackageDirectory;
  readonly managed: ManagedScriptPackage;
  readonly rootPath: string;
  readonly sourceRoot: string;
}

export class ScriptPackageCatalogError extends Schema.TaggedErrorClass<ScriptPackageCatalogError>()(
  "ScriptPackageCatalogError",
  {
    operation: Schema.Literal("scan"),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return "Failed to scan the script package catalog.";
  }
}

export interface ScriptPackageCatalogShape {
  readonly getOverview: Effect.Effect<
    ScriptCatalogOverview,
    ScriptPackageCatalogError
  >;
  readonly getDiscovery: Effect.Effect<
    DiscoveredScriptCatalog,
    ScriptPackageCatalogError
  >;
  readonly getPage: (
    request: ScriptCatalogPageRequest,
  ) => Effect.Effect<ScriptCatalogPage, ScriptPackageCatalogError>;
  readonly onChanged: (
    listener: (change: ScriptCatalogChange) => void,
  ) => Effect.Effect<() => void>;
  readonly referenceForPath: (
    path: string,
  ) => Effect.Effect<ScriptReference | undefined, ScriptPackageCatalogError>;
  readonly refresh: Effect.Effect<
    ScriptCatalogOverview,
    ScriptPackageCatalogError
  >;
  readonly removePackage: (
    packageName: string,
  ) => Effect.Effect<ScriptCatalogOverview, ScriptPackageCatalogError>;
  readonly replacePackage: (
    replacement: ScriptPackageCatalogReplacement,
  ) => Effect.Effect<ScriptCatalogOverview, ScriptPackageCatalogError>;
  readonly resolveReference: (
    reference: ScriptReference,
  ) => Effect.Effect<ScriptCatalogEntry | undefined, ScriptPackageCatalogError>;
  readonly updateManagedPackage: (
    managed: ManagedScriptPackage,
  ) => Effect.Effect<ScriptCatalogOverview, ScriptPackageCatalogError>;
}

export class ScriptPackageCatalog extends Context.Service<
  ScriptPackageCatalog,
  ScriptPackageCatalogShape
>()("lucent/desktop/scripting/ScriptPackageCatalog") {}

const optionalString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;

export const readScriptPackageManifest = async (
  path: string,
): Promise<ScriptPackageManifest> => {
  const stat = await fs.lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("package.json must be a file.");
  }
  if (stat.size > MANIFEST_MAX_BYTES) {
    throw new Error("package.json exceeds the 1 MiB limit.");
  }

  const record = parseManifestJson(await fs.readFile(path, "utf8"));
  const lucentVersion = optionalString(record.lucent?.version);
  const description = optionalString(record.description);
  const type = optionalString(record.type);
  const version = optionalString(record.version);
  return {
    name: record.name,
    main: optionalString(record.main) ?? "index.js",
    ...(description === undefined ? {} : { description }),
    ...(lucentVersion === undefined ? {} : { lucentVersion }),
    ...(type === undefined ? {} : { type }),
    ...(version === undefined ? {} : { version }),
  };
};

const assertPackageName = (name: string, expectedName: string): void => {
  if (name !== expectedName) {
    throw new Error(
      `The package name (${JSON.stringify(name)}) must match its folder name (${JSON.stringify(expectedName)}).`,
    );
  }
  try {
    decodePackageName(name);
  } catch {
    throw new Error("The package name contains unsupported characters.");
  }
};

const compatibilityFor = (
  currentVersion: string,
  requiredVersion: string | undefined,
): ScriptPackageCompatibility => {
  if (requiredVersion === undefined) {
    return { status: "unknown", currentVersion };
  }
  const normalizedRange = validRange(requiredVersion);
  if (normalizedRange === null) {
    return {
      status: "unknown",
      currentVersion,
      warning: `The Lucent version requirement is invalid: ${requiredVersion}.`,
    };
  }
  return {
    status: satisfies(currentVersion, normalizedRange)
      ? "compatible"
      : "incompatible",
    currentVersion,
    requiredVersion,
  };
};

const isJavaScriptFile = (path: string): boolean => {
  const extension = extname(path).toLowerCase();
  return extension === ".js" || extension === ".cjs";
};

const referenceKey = (reference: ScriptReference): string =>
  reference.kind === "loose"
    ? `loose:${reference.path}`
    : `package:${reference.packageName}:${reference.path}`;

const resolveMainPath = async (
  packageRoot: string,
  value: string,
): Promise<string | null> => {
  try {
    decodeRelativePath(value);
  } catch {
    throw new Error("The package.json main path is invalid.");
  }
  const segments = value.split("/");

  const initial = resolve(packageRoot, ...segments);
  if (!isPathInside(packageRoot, initial)) {
    throw new Error(
      "The package.json main path points outside the package folder.",
    );
  }
  const extension = extname(initial).toLowerCase();
  const candidates =
    extension === ".js" || extension === ".cjs"
      ? [initial]
      : [
          initial,
          `${initial}.js`,
          `${initial}.cjs`,
          join(initial, "index.js"),
          join(initial, "index.cjs"),
        ];

  for (const candidate of candidates) {
    try {
      const stat = await fs.lstat(candidate);
      if (!stat.isFile() || stat.isSymbolicLink()) continue;
      const realPath = await fs.realpath(candidate);
      if (!isPathInside(await fs.realpath(packageRoot), realPath)) {
        throw new Error(
          "The package.json main path points outside the package folder.",
        );
      }
      return candidate;
    } catch (cause) {
      if (isMissingFileError(cause)) continue;
      throw cause;
    }
  }
  return null;
};

/** Validates one package boundary and returns its loadable JavaScript inventory. */
export const inspectScriptPackageDirectory = async (
  rootPath: string,
  expectedName: string,
): Promise<InspectedScriptPackageDirectory> => {
  const manifest = await readScriptPackageManifest(
    join(rootPath, "package.json"),
  );
  assertPackageName(manifest.name, expectedName);
  const [mainPath, inventory] = await Promise.all([
    resolveMainPath(rootPath, manifest.main),
    listRegularFilePaths(rootPath, { maxFiles: SCRIPT_PACKAGE_MAX_FILES }),
  ]);
  return {
    files: inventory
      .filter((file) => isJavaScriptFile(file.relativePath))
      .map((file) => file.absolutePath),
    mainPath,
    manifest,
  };
};

const hashesMatch = (
  left: Readonly<Record<string, string>>,
  right: Readonly<Record<string, string>>,
): boolean => {
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);
  return (
    leftEntries.length === rightEntries.length &&
    leftEntries.every(([path, hash]) => right[path] === hash)
  );
};

const integrityFor = async (
  rootPath: string,
  managed: ManagedScriptPackage | undefined,
): Promise<"modified" | "unmanaged" | "verified"> => {
  if (managed === undefined) return "unmanaged";
  try {
    return hashesMatch(await hashDirectory(rootPath), managed.files)
      ? "verified"
      : "modified";
  } catch {
    return "modified";
  }
};

const naturalCompare = (left: string, right: string): number =>
  left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });

const compareScripts = (
  left: ScriptCatalogEntry,
  right: ScriptCatalogEntry,
): number => {
  const nameOrder = naturalCompare(left.name, right.name);
  if (nameOrder !== 0) return nameOrder;
  const packageOrder = naturalCompare(
    left.packageName ?? "",
    right.packageName ?? "",
  );
  return packageOrder !== 0
    ? packageOrder
    : naturalCompare(left.relativePath, right.relativePath);
};

const comparePackages = (
  left: ScriptPackageSummary,
  right: ScriptPackageSummary,
): number => naturalCompare(left.name ?? left.path, right.name ?? right.path);

const catalogRevision = (
  packages: readonly ScriptPackageSummary[],
  scripts: readonly ScriptCatalogEntry[],
): string =>
  sha256Revision(
    JSON.stringify({
      packages,
      scripts: scripts.map(
        ({ name, packageName, reference, relativePath }) => ({
          name,
          packageName,
          reference,
          relativePath,
        }),
      ),
    }),
  );

const makeDiscoveredScriptCatalog = (
  packages: readonly ScriptPackageSummary[],
  scripts: readonly ScriptCatalogEntry[],
  packageIndex: ReadonlyMap<string, DiscoveredScriptPackage>,
): DiscoveredScriptCatalog => {
  const sortedPackages = packages.toSorted(comparePackages);
  const sortedScripts = scripts.toSorted(compareScripts);
  const pathIndex = new Map<string, ScriptReference>();
  const scriptIndex = new Map<string, ScriptCatalogEntry>();
  for (const script of sortedScripts) {
    scriptIndex.set(referenceKey(script.reference), script);
    pathIndex.set(resolve(script.path), script.reference);
  }
  return {
    catalog: {
      packages: sortedPackages,
      revision: catalogRevision(sortedPackages, sortedScripts),
      scripts: sortedScripts,
    },
    packages: packageIndex,
    paths: pathIndex,
    scripts: scriptIndex,
  };
};

const catalogOverview = (
  discovery: DiscoveredScriptCatalog,
): ScriptCatalogOverview => ({
  packages: discovery.catalog.packages,
  revision: discovery.catalog.revision,
  scriptCount: discovery.catalog.scripts.length,
});

const packageModuleIndex = (
  rootPath: string,
  files: readonly string[],
): ReadonlyMap<string, string> =>
  new Map(
    files.map(
      (path) => [portablePath(relative(rootPath, path)), path] as const,
    ),
  );

export interface DiscoverScriptCatalogOptions {
  readonly currentVersion: string;
  readonly managedPackages?: readonly ManagedScriptPackage[];
  readonly packagesDir: string;
  readonly scriptsDir: string;
}

export const discoverScriptCatalog = async (
  options: DiscoverScriptCatalogOptions,
): Promise<DiscoveredScriptCatalog> => {
  const scripts: ScriptCatalogEntry[] = [];
  const packages: ScriptPackageSummary[] = [];
  const packageIndex = new Map<string, DiscoveredScriptPackage>();
  const managedPackages = new Map(
    (options.managedPackages ?? []).map((entry) => [entry.name, entry]),
  );

  const looseFiles = await listRegularFilePaths(options.scriptsDir);
  for (const file of looseFiles) {
    if (!isJavaScriptFile(file.relativePath)) continue;
    const reference: ScriptReference = {
      kind: "loose",
      path: file.relativePath,
    };
    scripts.push({
      name: basename(file.relativePath),
      path: file.absolutePath,
      reference,
      relativePath: file.relativePath,
    });
  }

  const visitPackages = async (directory: string): Promise<void> => {
    let entries: Dirent<string>[];
    try {
      entries = await fs.readdir(directory, {
        encoding: "utf8",
        withFileTypes: true,
      });
    } catch (cause) {
      if (isMissingFileError(cause)) return;
      throw cause;
    }
    entries.sort((left, right) => naturalCompare(left.name, right.name));

    const manifestEntry = entries.find(
      (entry) => entry.name === "package.json",
    );
    if (manifestEntry !== undefined) {
      const relativeName = portablePath(
        relative(options.packagesDir, directory),
      );
      let parsedName: string | undefined;
      try {
        parsedName = (
          await readScriptPackageManifest(join(directory, "package.json"))
        ).name;
        const inspected = await inspectScriptPackageDirectory(
          directory,
          relativeName,
        );
        const { mainPath, manifest } = inspected;

        const packageRealPath = await fs.realpath(directory);
        const packagesRealPath = await fs.realpath(options.packagesDir);
        if (!isPathInside(packagesRealPath, packageRealPath)) {
          throw new Error(
            "The package points outside Lucent's packages folder.",
          );
        }
        if (
          [...packageIndex.values()].some(
            (entry) => resolve(entry.rootPath) === resolve(directory),
          )
        ) {
          throw new Error(
            "This package points to a folder already used by another package.",
          );
        }
        const compatibility = compatibilityFor(
          options.currentVersion,
          manifest.lucentVersion,
        );
        const managed = managedPackages.get(manifest.name);
        const integrity = await integrityFor(directory, managed);
        const warning =
          compatibility.status === "unknown"
            ? compatibility.warning
            : mainPath === null
              ? `The package's main file was not found: ${manifest.main}.`
              : undefined;

        packages.push({
          status: "valid",
          compatibility,
          ...(manifest.description === undefined
            ? {}
            : { description: manifest.description }),
          integrity,
          name: manifest.name,
          path: directory,
          ...(managed === undefined ? {} : { source: managed.source }),
          update: managed?.update ?? { status: "unchecked" },
          ...(manifest.version === undefined
            ? {}
            : { version: manifest.version }),
          ...(warning === undefined ? {} : { warning }),
        });
        packageIndex.set(manifest.name, {
          compatibility,
          files: inspected.files,
          mainPath,
          manifest,
          modules: packageModuleIndex(directory, inspected.files),
          name: manifest.name,
          rootPath: directory,
        });

        const scriptRoot = join(directory, "scripts");
        for (const absolutePath of inspected.files) {
          if (!isPathInside(scriptRoot, absolutePath)) continue;
          const packageScriptPath = portablePath(
            relative(directory, absolutePath),
          );
          if (packageScriptPath === "scripts") continue;
          const relativePath = portablePath(relative(scriptRoot, absolutePath));
          const reference: ScriptReference = {
            kind: "package",
            packageName: manifest.name,
            path: packageScriptPath,
          };
          scripts.push({
            name: basename(relativePath),
            packageName: manifest.name,
            path: absolutePath,
            reference,
            relativePath,
          });
        }
      } catch (cause) {
        packages.push({
          status: "invalid",
          diagnostic:
            cause instanceof Error && cause.message !== ""
              ? cause.message
              : "This folder isn't a valid package.",
          ...(parsedName === undefined ? {} : { name: parsedName }),
          path: directory,
        });
      }
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      await visitPackages(join(directory, entry.name));
    }
  };

  await visitPackages(options.packagesDir);

  return makeDiscoveredScriptCatalog(packages, scripts, packageIndex);
};

const replaceDiscoveredPackage = (
  current: DiscoveredScriptCatalog,
  replacement: ScriptPackageCatalogReplacement,
  currentVersion: string,
): DiscoveredScriptCatalog => {
  const { inspected, managed, rootPath, sourceRoot } = replacement;
  const remapPath = (path: string): string =>
    resolve(rootPath, relative(sourceRoot, path));
  const files = inspected.files.map(remapPath);
  const mainPath =
    inspected.mainPath === null ? null : remapPath(inspected.mainPath);
  const compatibility = compatibilityFor(
    currentVersion,
    inspected.manifest.lucentVersion,
  );
  const warning =
    compatibility.status === "unknown"
      ? compatibility.warning
      : mainPath === null
        ? `The package's main file was not found: ${inspected.manifest.main}.`
        : undefined;
  const summary: ScriptPackageSummary = {
    status: "valid",
    compatibility,
    ...(inspected.manifest.description === undefined
      ? {}
      : { description: inspected.manifest.description }),
    integrity: "verified",
    name: managed.name,
    path: rootPath,
    source: managed.source,
    update: managed.update ?? { status: "unchecked" },
    ...(inspected.manifest.version === undefined
      ? {}
      : { version: inspected.manifest.version }),
    ...(warning === undefined ? {} : { warning }),
  };
  const packageEntry: DiscoveredScriptPackage = {
    compatibility,
    files,
    mainPath,
    manifest: inspected.manifest,
    modules: packageModuleIndex(rootPath, files),
    name: managed.name,
    rootPath,
  };
  const scriptRoot = join(rootPath, "scripts");
  const scripts = current.catalog.scripts.filter(
    (entry) =>
      entry.reference.kind !== "package" ||
      entry.reference.packageName !== managed.name,
  );
  for (const absolutePath of files) {
    if (!isPathInside(scriptRoot, absolutePath)) continue;
    const packageScriptPath = portablePath(relative(rootPath, absolutePath));
    if (packageScriptPath === "scripts") continue;
    const relativePath = portablePath(relative(scriptRoot, absolutePath));
    scripts.push({
      name: basename(relativePath),
      packageName: managed.name,
      path: absolutePath,
      reference: {
        kind: "package",
        packageName: managed.name,
        path: packageScriptPath,
      },
      relativePath,
    });
  }

  const normalizedRoot = resolve(rootPath);
  const packages = current.catalog.packages.filter(
    (entry) =>
      resolve(entry.path) !== normalizedRoot &&
      !(entry.status === "valid" && entry.name === managed.name),
  );
  packages.push(summary);
  const packageIndex = new Map(current.packages);
  packageIndex.set(managed.name, packageEntry);
  return makeDiscoveredScriptCatalog(packages, scripts, packageIndex);
};

const removeDiscoveredPackage = (
  current: DiscoveredScriptCatalog,
  packageName: string,
): DiscoveredScriptCatalog => {
  const rootPath = current.packages.get(packageName)?.rootPath;
  const packages = current.catalog.packages.filter(
    (entry) =>
      !(entry.status === "valid" && entry.name === packageName) &&
      (rootPath === undefined || resolve(entry.path) !== resolve(rootPath)),
  );
  const scripts = current.catalog.scripts.filter(
    (entry) =>
      entry.reference.kind !== "package" ||
      entry.reference.packageName !== packageName,
  );
  const packageIndex = new Map(current.packages);
  packageIndex.delete(packageName);
  return makeDiscoveredScriptCatalog(packages, scripts, packageIndex);
};

const updateDiscoveredManagedPackage = (
  current: DiscoveredScriptCatalog,
  managed: ManagedScriptPackage,
): DiscoveredScriptCatalog => {
  let changed = false;
  const packages = current.catalog.packages.map((entry) => {
    if (entry.status !== "valid" || entry.name !== managed.name) return entry;
    changed = true;
    return {
      ...entry,
      source: managed.source,
      update: managed.update ?? { status: "unchecked" },
    } satisfies ScriptPackageSummary;
  });
  return changed
    ? makeDiscoveredScriptCatalog(
        packages,
        current.catalog.scripts,
        current.packages,
      )
    : current;
};

export const layer = Layer.effect(
  ScriptPackageCatalog,
  Effect.gen(function* () {
    const app = yield* ElectronApp;
    const env = yield* DesktopEnvironment;
    const state = yield* ScriptPackageState;
    const currentVersion = yield* app.getVersion;
    const changes = makeListenerRegistry<ScriptCatalogChange>();
    const scanGate = yield* Semaphore.make(1);
    const lastScanRef = yield* Ref.make<DiscoveredScriptCatalog | null>(null);
    const cacheKey = "catalog" as const;

    const scan = scanGate.withPermits(1)(
      Effect.gen(function* () {
        const managedPackages = yield* state.getAll;
        return yield* Effect.tryPromise({
          try: async () => {
            await Promise.all([
              fs.mkdir(env.scriptsDir, { recursive: true }),
              fs.mkdir(env.packagesDir, { recursive: true }),
            ]);
            return discoverScriptCatalog({
              currentVersion,
              managedPackages,
              packagesDir: env.packagesDir,
              scriptsDir: env.scriptsDir,
            });
          },
          catch: (cause) =>
            new ScriptPackageCatalogError({ operation: "scan", cause }),
        });
      }).pipe(Effect.tap((discovery) => Ref.set(lastScanRef, discovery))),
    );

    const discoveryCache = yield* Cache.make<
      typeof cacheKey,
      DiscoveredScriptCatalog,
      ScriptPackageCatalogError
    >({
      capacity: 1,
      lookup: () => scan,
    });
    // Cache owns the sole lazy scan. Only refresh below asks it to run lookup again.
    const getDiscovery = Cache.get(discoveryCache, cacheKey);

    const refreshDiscovery = Cache.refresh(discoveryCache, cacheKey).pipe(
      Effect.catch((cause) =>
        Effect.gen(function* () {
          const lastScan = yield* Ref.get(lastScanRef);
          if (lastScan === null) {
            yield* Cache.invalidate(discoveryCache, cacheKey);
          } else {
            yield* Cache.set(discoveryCache, cacheKey, lastScan);
          }
          return yield* cause;
        }),
      ),
    );

    const refresh = refreshDiscovery.pipe(
      Effect.tap((discovery) =>
        changes.publish({ revision: discovery.catalog.revision }),
      ),
      Effect.map(catalogOverview),
    );

    const updateDiscovery = Effect.fn("ScriptPackageCatalog.updateDiscovery")(
      function* (
        transform: (
          current: DiscoveredScriptCatalog,
        ) => DiscoveredScriptCatalog,
      ) {
        yield* getDiscovery;
        return yield* scanGate.withPermits(1)(
          Effect.gen(function* () {
            const current = yield* Cache.get(discoveryCache, cacheKey);
            const next = transform(current);
            if (next !== current) {
              yield* Cache.set(discoveryCache, cacheKey, next);
              yield* Ref.set(lastScanRef, next);
              yield* changes.publish({ revision: next.catalog.revision });
            }
            return catalogOverview(next);
          }),
        );
      },
    );

    return ScriptPackageCatalog.of({
      getDiscovery,
      getOverview: getDiscovery.pipe(Effect.map(catalogOverview)),
      getPage: (request) =>
        getDiscovery.pipe(
          Effect.map((discovery) => {
            const query = request.query.trim().toLocaleLowerCase();
            const matching =
              query === ""
                ? discovery.catalog.scripts
                : discovery.catalog.scripts.filter((entry) =>
                    [
                      entry.name,
                      entry.relativePath,
                      entry.packageName ?? "",
                    ].some((value) =>
                      value.toLocaleLowerCase().includes(query),
                    ),
                  );
            return {
              entries: matching.slice(
                request.offset,
                request.offset + request.limit,
              ),
              offset: request.offset,
              revision: discovery.catalog.revision,
              total: matching.length,
            } satisfies ScriptCatalogPage;
          }),
        ),
      onChanged: changes.subscribe,
      referenceForPath: (path) =>
        getDiscovery.pipe(
          Effect.map((discovery) => discovery.paths.get(resolve(path))),
        ),
      refresh,
      removePackage: (packageName) =>
        updateDiscovery((current) =>
          removeDiscoveredPackage(current, packageName),
        ),
      replacePackage: (replacement) =>
        updateDiscovery((current) =>
          replaceDiscoveredPackage(current, replacement, currentVersion),
        ),
      resolveReference: (reference) =>
        getDiscovery.pipe(
          Effect.map((discovery) =>
            discovery.scripts.get(referenceKey(reference)),
          ),
        ),
      updateManagedPackage: (managed) =>
        updateDiscovery((current) =>
          updateDiscoveredManagedPackage(current, managed),
        ),
    });
  }),
);
