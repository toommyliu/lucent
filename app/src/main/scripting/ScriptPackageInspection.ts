import {
  lstatPath,
  nativeCause,
  realPath,
} from "../filesystem/BoundedFileSystem";
import { basename, extname, join, relative, resolve, sep } from "node:path";

import * as Schema from "effect/Schema";
import { isPlatformError, type PlatformError } from "effect/PlatformError";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import { FileSystem } from "effect/FileSystem";
import { satisfies, valid, validRange } from "semver";

import type {
  ScriptPackageCompatibility,
  ScriptPackageName,
  ScriptReference,
} from "@lucent/core/scriptPackages";
import {
  ScriptPackageDirectorySchema,
  ScriptPackageNameSchema,
  ScriptRelativePathSchema,
} from "@lucent/core/scriptPackages";
import {
  hashDirectory,
  InvalidScriptPackage,
  type PackageFileError,
  isPathInside,
  listRegularFilePaths,
  portablePath,
} from "./ScriptPackageFileSystem";
import {
  formatBytes,
  SCRIPT_PACKAGE_MANIFEST_MAX_BYTES,
  SCRIPT_PACKAGE_MAX_FILES,
} from "./ScriptLimits";
import type { ManagedScriptPackage } from "./ScriptPackageState";
import { logFailure } from "../../shared/logFailure";
import {
  fileReadError,
  readFileBounded,
} from "../filesystem/BoundedFileSystem";

export interface ScriptPackageInspectionFailure {
  readonly packageName: string;
  readonly error: PlatformError;
}

export const logScriptPackageInspectionFailures = Effect.fnUntraced(function* (
  failures: readonly ScriptPackageInspectionFailure[],
) {
  if (failures.length === 0) return;
  const packageNames = [
    ...new Set(failures.map((failure) => failure.packageName)),
  ].toSorted();
  const cause = failures.reduce<Cause.Cause<unknown>>(
    (combined, failure) =>
      Cause.combine(combined, Cause.fail(nativeCause(failure.error))),
    Cause.empty,
  );
  yield* logFailure("Failed to inspect script package files", cause, {
    failure: "warning",
  }).pipe(
    Effect.annotateLogs({
      component: "script-packages",
      repeatKey: packageNames.join(","),
      data: { packageNames },
    }),
  );
});

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
      dependencies: Schema.optionalKey(
        Schema.Record(Schema.String, Schema.String),
      ),
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

export const decodePackageDirectory = Schema.decodeUnknownSync(
  ScriptPackageDirectorySchema,
);

const decodePackageName = Schema.decodeUnknownSync(ScriptPackageNameSchema);
export { decodePackageName };

const decodeRelativePath = Schema.decodeUnknownSync(ScriptRelativePathSchema);

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
  readonly dependencies: Readonly<Record<string, string>>;
  readonly description?: string;
  readonly lucentVersion?: string;
  readonly main: string;
  readonly name: string;
  readonly type?: string;
  readonly version?: string;
}

export interface InspectedScriptPackageDirectory {
  readonly files: readonly string[];
  readonly mainPath: string | null;
  readonly manifest: ScriptPackageManifest & {
    readonly name: ScriptPackageName;
  };
}

const optionalString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;

const parseManifest = (bytes: Uint8Array): ScriptPackageManifest => {
  const record = parseManifestJson(
    Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString(
      "utf8",
    ),
  );
  const lucentVersion = optionalString(record.lucent?.version);
  const description = optionalString(record.description);
  const type = optionalString(record.type);
  const declaredVersion = optionalString(record.version);
  const version =
    declaredVersion === undefined ? undefined : valid(declaredVersion);
  if (declaredVersion !== undefined && version === null) {
    throw new Error("The package version must be an exact semantic version.");
  }
  const dependencies: Record<string, string> = Object.create(null) as Record<
    string,
    string
  >;
  for (const [dependencyName, rawRange] of Object.entries(
    record.lucent?.dependencies ?? {},
  )) {
    try {
      decodePackageName(dependencyName);
    } catch {
      throw new Error(
        `The Lucent dependency name (${JSON.stringify(dependencyName)}) is invalid.`,
      );
    }
    if (dependencyName === record.name) {
      throw new Error(
        "A package must not declare itself as a Lucent dependency.",
      );
    }
    const dependencyRange = optionalString(rawRange);
    if (dependencyRange === undefined || validRange(dependencyRange) === null) {
      throw new Error(
        `The Lucent dependency version for ${JSON.stringify(dependencyName)} is invalid.`,
      );
    }
    dependencies[dependencyName] = dependencyRange;
  }
  return {
    dependencies,
    name: record.name,
    main: optionalString(record.main) ?? "index.js",
    ...(description === undefined ? {} : { description }),
    ...(lucentVersion === undefined ? {} : { lucentVersion }),
    ...(type === undefined ? {} : { type }),
    ...(version === undefined || version === null ? {} : { version }),
  };
};

const manifestLimitExceeded = () =>
  new InvalidScriptPackage({
    detail: `package.json exceeds the ${formatBytes(SCRIPT_PACKAGE_MANIFEST_MAX_BYTES)} limit.`,
  });

export const readScriptPackageManifest = Effect.fn("readScriptPackageManifest")(
  function* (path: string) {
    const stat = yield* lstatPath(path);
    if (stat.kind !== "file")
      return yield* new InvalidScriptPackage({
        detail: "package.json must be a file.",
      });
    if (stat.size > SCRIPT_PACKAGE_MANIFEST_MAX_BYTES)
      return yield* manifestLimitExceeded();
    const fileSystem = yield* FileSystem;
    const bytes = yield* readFileBounded(
      fileSystem,
      path,
      SCRIPT_PACKAGE_MANIFEST_MAX_BYTES,
    ).pipe(
      Effect.mapError((error) =>
        error._tag === "FileSystemLimitError"
          ? manifestLimitExceeded()
          : fileReadError(path)(error),
      ),
    );
    return yield* Effect.try({
      try: () => parseManifest(bytes),
      catch: (cause) =>
        InvalidScriptPackage.fromUnknown(
          cause,
          "This folder isn't a valid package.",
        ),
    });
  },
);

const parsePackageName = (name: string): ScriptPackageName => {
  try {
    return decodePackageName(name);
  } catch {
    throw new Error("The package name contains unsupported characters.");
  }
};

export const compatibilityFor = (
  currentVersion: string,
  requiredVersion: string | undefined,
): ScriptPackageCompatibility => {
  if (requiredVersion === undefined) {
    return { status: "unknown", currentVersion };
  }
  const normalizedRange = validRange(requiredVersion, {
    includePrerelease: true,
  });
  if (normalizedRange === null) {
    return {
      status: "unknown",
      currentVersion,
      warning: `The Lucent version requirement is invalid: ${requiredVersion}.`,
    };
  }
  return {
    status: satisfies(currentVersion, normalizedRange, {
      includePrerelease: true,
    })
      ? "compatible"
      : "incompatible",
    currentVersion,
    requiredVersion,
  };
};

export const isJavaScriptFile = (path: string): boolean => {
  const extension = extname(path).toLowerCase();
  return extension === ".js" || extension === ".cjs";
};

export const resolveLooseScriptReference = Effect.fn(
  "resolveLooseScriptReference",
)(function* (
  scriptsDir: string,
  path: string,
): Effect.fn.Return<
  Extract<ScriptReference, { readonly kind: "loose" }> | undefined
> {
  const rootPath = resolve(scriptsDir);
  const selectedPath = resolve(path);
  const selectedName = basename(selectedPath);
  if (
    selectedPath === rootPath ||
    !isPathInside(rootPath, selectedPath) ||
    !isJavaScriptFile(selectedPath) ||
    selectedName.startsWith("._")
  ) {
    return undefined;
  }

  const nativeRelativePath = relative(rootPath, selectedPath);
  const segments = nativeRelativePath.split(sep);
  let currentPath = rootPath;
  return yield* Effect.gen(function* () {
    for (const [index, segment] of segments.entries()) {
      currentPath = join(currentPath, segment);
      const stat = yield* lstatPath(currentPath);
      if (stat.kind === "symbolic-link") return undefined;

      const isSelectedFile = index === segments.length - 1;
      if (isSelectedFile ? stat.kind !== "file" : stat.kind !== "directory") {
        return undefined;
      }
    }
    const [realRootPath, realSelectedPath] = yield* Effect.all(
      [realPath(rootPath), realPath(selectedPath)],
      { concurrency: 2 },
    );
    if (!isPathInside(realRootPath, realSelectedPath)) return undefined;
    return {
      kind: "loose",
      path: portablePath(relative(realRootPath, realSelectedPath)),
    } satisfies ScriptReference;
  }).pipe(Effect.orElseSucceed(() => undefined));
});

const resolveMainPath = Effect.fnUntraced(function* (
  packageRoot: string,
  value: string,
) {
  yield* Effect.try({
    try: () => decodeRelativePath(value),
    catch: () =>
      new InvalidScriptPackage({
        detail: "The package.json main path is invalid.",
      }),
  });
  const segments = value.split("/");
  const initial = resolve(packageRoot, ...segments);
  if (!isPathInside(packageRoot, initial))
    return yield* new InvalidScriptPackage({
      detail: "The package.json main path points outside the package folder.",
    });
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
    const found = yield* Effect.gen(function* () {
      const stat = yield* lstatPath(candidate);
      if (stat.kind !== "file") return null;
      const canonicalPath = yield* realPath(candidate);
      if (!isPathInside(yield* realPath(packageRoot), canonicalPath))
        return yield* new InvalidScriptPackage({
          detail:
            "The package.json main path points outside the package folder.",
        });
      return candidate;
    }).pipe(Effect.catchTag("FileNotFound", () => Effect.succeed(null)));
    if (found !== null) return found;
  }
  return null;
});

export const inspectScriptPackageDirectory = Effect.fn(
  "inspectScriptPackageDirectory",
)(function* (
  rootPath: string,
  validatedManifest?: InspectedScriptPackageDirectory["manifest"],
): Effect.fn.Return<
  InspectedScriptPackageDirectory,
  PackageFileError,
  FileSystem
> {
  const manifest =
    validatedManifest ??
    (yield* readScriptPackageManifest(join(rootPath, "package.json")));
  const name =
    validatedManifest?.name ??
    (yield* Effect.try({
      try: () => parsePackageName(manifest.name),
      catch: (cause) =>
        InvalidScriptPackage.fromUnknown(
          cause,
          "This folder isn't a valid package.",
        ),
    }));
  const [mainPath, inventory] = yield* Effect.all(
    [
      resolveMainPath(rootPath, manifest.main),
      listRegularFilePaths(rootPath, { maxFiles: SCRIPT_PACKAGE_MAX_FILES }),
    ],
    { concurrency: 2 },
  );
  return {
    files: inventory
      .filter((file) => isJavaScriptFile(file.relativePath))
      .map((file) => file.absolutePath),
    mainPath,
    manifest: { ...manifest, name },
  };
});

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

export const inspectManagedPackageFolder = Effect.fn(
  "inspectManagedPackageFolder",
)(function* (
  packagesDir: string,
  rootPath: string,
  managed: ManagedScriptPackage | undefined,
  validatedManifest?: InspectedScriptPackageDirectory["manifest"],
) {
  if ((yield* lstatPath(rootPath)).kind !== "directory")
    return yield* new InvalidScriptPackage({
      detail: "The package folder is not a regular directory.",
    });
  const inspected = yield* inspectScriptPackageDirectory(
    rootPath,
    validatedManifest,
  );
  if (managed !== undefined && managed.name !== inspected.manifest.name)
    return yield* new InvalidScriptPackage({
      detail: `The installed package name is ${JSON.stringify(managed.name)}, but package.json declares ${JSON.stringify(inspected.manifest.name)}.`,
    });
  if (!isPathInside(yield* realPath(packagesDir), yield* realPath(rootPath)))
    return yield* new InvalidScriptPackage({
      detail: "The package points outside Lucent's packages folder.",
    });
  return inspected;
});

export interface IntegrityCheck {
  readonly integrity: "modified" | "unmanaged" | "verified";
  readonly failure?: PlatformError;
}

export const integrityFor = Effect.fn("integrityFor")(function* (
  rootPath: string,
  managed: ManagedScriptPackage | undefined,
): Effect.fn.Return<IntegrityCheck, never, FileSystem> {
  if (managed === undefined) return { integrity: "unmanaged" };
  return yield* hashDirectory(rootPath).pipe(
    Effect.map(
      (hashes): IntegrityCheck => ({
        integrity: hashesMatch(hashes, managed.files) ? "verified" : "modified",
      }),
    ),
    Effect.catch((error) =>
      Effect.succeed<IntegrityCheck>({
        integrity: "modified",
        ...(isPlatformError(error) ? { failure: error } : {}),
      }),
    ),
  );
});
