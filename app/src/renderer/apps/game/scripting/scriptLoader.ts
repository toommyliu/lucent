import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type {
  ScriptExecutionSnapshot,
  ScriptModuleSource,
} from "@lucent/core/scriptPackages";
import {
  isScriptBuiltinModuleSpecifier,
  isRelativeScriptModuleSpecifier,
  resolveRelativeScriptModulePath,
  scriptModulePathCandidates,
} from "@lucent/core/scriptPackages";
import type { ScriptMain } from "./ScriptApi";
import type { ScriptBuiltinModules } from "./ScriptBuiltinModules";

export class ScriptLoadError extends Schema.TaggedErrorClass<ScriptLoadError>()(
  "ScriptLoadError",
  {
    detail: Schema.String,
    cause: Schema.optionalKey(Schema.Defect()),
    modulePath: Schema.optionalKey(Schema.String),
  },
) {
  override get message(): string {
    return this.detail;
  }
}

export interface LoadedScriptModule {
  readonly main: ScriptMain;
}

interface CommonJsModule {
  exports: unknown;
}

type CommonJsRequire = (id: string) => unknown;

const CommonJsFunction = Function as unknown as new (
  ...args: string[]
) => (
  module: CommonJsModule,
  exports: unknown,
  require: CommonJsRequire,
) => void;

export const sanitizeScriptSourceUrl = (
  name: string | undefined,
  revision?: string,
): string => {
  const fallback = "anonymous-script";
  const normalized = (name ?? fallback)
    .trim()
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean)
    .pop();
  const slug = (normalized ?? fallback)
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  const sourceUrl = `lucent-script://${encodeURIComponent(slug === "" ? fallback : slug)}`;
  const normalizedRevision = revision?.trim();
  return normalizedRevision === undefined || normalizedRevision === ""
    ? sourceUrl
    : `${sourceUrl}?v=${encodeURIComponent(normalizedRevision)}`;
};

const isGeneratorFunction = (value: unknown): value is ScriptMain =>
  typeof value === "function" &&
  value.constructor?.name === "GeneratorFunction";

const moduleDisplayPath = (module: ScriptModuleSource): string =>
  module.packageName === undefined
    ? module.path
    : `${module.packageName}/${module.path}`;

const moduleSourceUrl = (module: ScriptModuleSource): string => {
  const encodedPath = module.path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const identity =
    module.packageName === undefined
      ? `loose/${encodedPath}`
      : `package/${encodeURIComponent(module.packageName)}/${encodedPath}`;
  return `lucent-script://${identity}?v=${encodeURIComponent(module.revision)}`;
};

const coordinateKey = (packageName: string | undefined, path: string): string =>
  `${packageName ?? ""}\0${path}`;

interface ImportStep {
  readonly importer: ScriptModuleSource;
  readonly specifier: string;
}

const missingImportError = (
  steps: readonly ImportStep[],
  importer: ScriptModuleSource,
  specifier: string,
): ScriptLoadError => {
  const chain = [...steps, { importer, specifier }]
    .map(
      (step, index) =>
        `${index === 0 ? "" : "  -> "}${moduleDisplayPath(step.importer)} requires ${JSON.stringify(step.specifier)}`,
    )
    .join("\n");
  return new ScriptLoadError({
    detail: `Script import was not found:\n${chain}`,
    modulePath: importer.localPath,
  });
};

const syntheticSnapshot = (input: {
  readonly name?: string;
  readonly revision?: string;
  readonly source: string;
}): ScriptExecutionSnapshot => {
  const revision = input.revision ?? "unversioned";
  const path = input.name ?? "anonymous-script.js";
  return {
    entryModuleId: "entry",
    modules: [
      {
        format: "commonjs",
        id: "entry",
        localPath: path,
        path,
        revision,
        source: input.source,
      },
    ],
    packages: [],
    revision,
  };
};

/**
 * Resolves Lucent's supported CommonJS subset. Author code must use literal
 * `require` specifiers; computed specifiers and dynamic `import()` are outside
 * the compatibility contract and intentionally are not statically analyzed.
 */
const evaluateSnapshot = (
  snapshot: ScriptExecutionSnapshot,
  modules: ScriptBuiltinModules,
): LoadedScriptModule => {
  const modulesById = new Map(
    snapshot.modules.map((module) => [module.id, module]),
  );
  const modulesByCoordinate = new Map(
    snapshot.modules.map((module) => [
      coordinateKey(module.packageName, module.path),
      module,
    ]),
  );
  const packages = new Map(
    snapshot.packages.map((entry) => [entry.name, entry]),
  );
  const cache = new Map<string, CommonJsModule>();

  const resolveRelative = (
    importer: ScriptModuleSource,
    specifier: string,
  ): ScriptModuleSource | undefined => {
    const normalized = resolveRelativeScriptModulePath(
      importer.path,
      specifier,
    );
    if (normalized === null) return undefined;
    for (const candidate of scriptModulePathCandidates(normalized)) {
      const resolved = modulesByCoordinate.get(
        coordinateKey(importer.packageName, candidate),
      );
      if (resolved !== undefined) return resolved;
    }
    return undefined;
  };

  const loadModule = (
    module: ScriptModuleSource,
    steps: readonly ImportStep[],
  ): unknown => {
    const cached = cache.get(module.id);
    if (cached !== undefined) return cached.exports;
    if (module.format === "unsupported-esm") {
      throw new ScriptLoadError({
        detail: `${moduleDisplayPath(module)} is an ES module. Lucent supports CommonJS .js files or .cjs files in packages with type=module.`,
        modulePath: module.localPath,
      });
    }

    const commonJsModule: CommonJsModule = { exports: {} };
    cache.set(module.id, commonJsModule);
    const require: CommonJsRequire = (specifier) => {
      if (typeof specifier !== "string") {
        throw new ScriptLoadError({
          detail: `${moduleDisplayPath(module)} called require with a non-string specifier.`,
          modulePath: module.localPath,
        });
      }
      if (isScriptBuiltinModuleSpecifier(specifier)) {
        return modules[specifier];
      }

      let resolved: ScriptModuleSource | undefined;
      if (isRelativeScriptModuleSpecifier(specifier)) {
        resolved = resolveRelative(module, specifier);
      } else {
        const importedPackage = packages.get(specifier);
        if (importedPackage?.compatibility.status === "incompatible") {
          throw new ScriptLoadError({
            detail: `${importedPackage.name} requires Lucent ${importedPackage.compatibility.requiredVersion}; this app is ${importedPackage.compatibility.currentVersion}.`,
            modulePath: module.localPath,
          });
        }
        resolved =
          importedPackage?.mainModuleId === null ||
          importedPackage?.mainModuleId === undefined
            ? undefined
            : modulesById.get(importedPackage.mainModuleId);
      }

      if (resolved === undefined) {
        throw missingImportError(steps, module, specifier);
      }
      return loadModule(resolved, [...steps, { importer: module, specifier }]);
    };

    try {
      const execute = new CommonJsFunction(
        "module",
        "exports",
        "require",
        `"use strict";\n${module.source}\n//# sourceURL=${moduleSourceUrl(module)}`,
      );
      execute(commonJsModule, commonJsModule.exports, require);
      return commonJsModule.exports;
    } catch (cause) {
      cache.delete(module.id);
      if (cause instanceof ScriptLoadError) throw cause;
      throw new ScriptLoadError({
        detail: `${moduleDisplayPath(module)} failed to load: ${cause instanceof Error ? cause.message : String(cause)}`,
        modulePath: module.localPath,
        cause,
      });
    }
  };

  const entry = modulesById.get(snapshot.entryModuleId);
  if (entry === undefined) {
    throw new ScriptLoadError({
      detail: "The execution snapshot does not contain its entry module.",
    });
  }
  const exports = loadModule(entry, []);
  if (!isGeneratorFunction(exports)) {
    throw new ScriptLoadError({
      detail: `${moduleDisplayPath(entry)} must export a generator function.`,
      modulePath: entry.localPath,
    });
  }
  return { main: exports };
};

export const loadScriptModule = (input: {
  readonly modules: ScriptBuiltinModules;
  readonly name?: string;
  readonly revision?: string;
  readonly snapshot?: ScriptExecutionSnapshot;
  readonly source: string;
}): Effect.Effect<LoadedScriptModule, ScriptLoadError> =>
  Effect.try({
    try: () => {
      const snapshot =
        input.snapshot ??
        syntheticSnapshot({
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.revision === undefined ? {} : { revision: input.revision }),
          source: input.source,
        });
      return evaluateSnapshot(snapshot, input.modules);
    },
    catch: (cause) =>
      cause instanceof ScriptLoadError
        ? cause
        : new ScriptLoadError({
            detail: `Script failed to load: ${cause instanceof Error ? cause.message : String(cause)}`,
            cause,
          }),
  });
