import { join } from "node:path";

import * as Context from "effect/Context";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SynchronizedRef from "effect/SynchronizedRef";
import * as Schema from "effect/Schema";

import {
  ScriptPackageDirectorySchema,
  ScriptPackageNameSchema,
  ScriptPackageRepositorySubdirectorySchema,
  ScriptPackageRevisionSchema,
  ScriptPackageSourceSchema,
  ScriptPackageUpdateStateSchema,
  type ScriptPackageDirectory,
  type ScriptPackageName,
  type ScriptPackageSource,
  type ScriptPackageUpdateState,
} from "@lucent/core/scriptPackages";
import { DesktopEnvironment } from "../app/DesktopEnvironment";
import { FileSystem } from "effect/FileSystem";
import { makeJsonFile } from "../filesystem/JsonFile";

const FileHashesSchema = Schema.Record(Schema.String, Schema.String);

const CommitLookupSchema = Schema.Struct({
  etag: Schema.String,
  commit: Schema.String,
});

export const ManagedScriptPackageSchema = Schema.Struct({
  name: ScriptPackageNameSchema,
  directory: ScriptPackageDirectorySchema,
  installedAt: Schema.String,
  files: FileHashesSchema,
  source: ScriptPackageSourceSchema,
  commitLookup: Schema.optionalKey(CommitLookupSchema),
  update: ScriptPackageUpdateStateSchema,
});

const LegacyScriptPackageSourceSchema = Schema.Union([
  ScriptPackageSourceSchema,
  Schema.Struct({
    kind: Schema.Literal("directory"),
    repositoryUrl: Schema.String,
    requestedRef: Schema.optionalKey(Schema.String),
    credentialId: Schema.optionalKey(Schema.String),
    resolvedTree: Schema.String,
    subdirectory: ScriptPackageRepositorySubdirectorySchema,
  }),
]);

const LegacyManagedScriptPackageSchema = Schema.Struct({
  name: ScriptPackageNameSchema,
  directory: ScriptPackageDirectorySchema,
  installedAt: Schema.String,
  files: FileHashesSchema,
  source: LegacyScriptPackageSourceSchema,
  etag: Schema.optionalKey(Schema.String),
  remoteRevision: Schema.optionalKey(ScriptPackageRevisionSchema),
  update: Schema.optionalKey(ScriptPackageUpdateStateSchema),
});

const ScriptPackageStateFileSchema = Schema.Union([
  Schema.Struct({
    version: Schema.Literal(2),
    packages: Schema.Array(ManagedScriptPackageSchema),
  }),
  Schema.Struct({
    version: Schema.Literal(1),
    packages: Schema.Array(LegacyManagedScriptPackageSchema),
  }),
]);

const decodeStateFile = Schema.decodeUnknownOption(
  ScriptPackageStateFileSchema,
);

const fromLegacy = ({
  etag,
  remoteRevision,
  source,
  update,
  ...entry
}: typeof LegacyManagedScriptPackageSchema.Type): ManagedScriptPackage => ({
  ...entry,
  source:
    source.kind === "directory" && !("resolvedCommit" in source)
      ? { ...source, kind: "bundled" }
      : source,
  ...(etag !== undefined && remoteRevision?.kind === "commit"
    ? { commitLookup: { etag, commit: remoteRevision.sha } }
    : {}),
  update: update ?? { status: "unchecked" },
});

export interface ManagedScriptPackage {
  readonly name: ScriptPackageName;
  readonly directory: ScriptPackageDirectory;
  readonly installedAt: string;
  readonly files: Readonly<Record<string, string>>;
  readonly source: ScriptPackageSource;
  readonly commitLookup?: { readonly etag: string; readonly commit: string };
  readonly update: ScriptPackageUpdateState;
}

type ScriptPackageLoadState =
  | {
      readonly status: "loaded";
      readonly packages: Map<string, ManagedScriptPackage>;
    }
  | {
      readonly status: "failed";
      readonly error: ScriptPackageStateError;
    };

export class ScriptPackageStateError extends Schema.TaggedError<ScriptPackageStateError>()(
  "ScriptPackageStateError",
  {
    operation: Schema.Literals(["load", "save"]),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to ${this.operation} script package state.`;
  }
}

export interface ScriptPackageStateShape {
  readonly get: (
    name: string,
  ) => Effect.Effect<ManagedScriptPackage | undefined>;
  readonly getAll: Effect.Effect<readonly ManagedScriptPackage[]>;
  readonly remove: (
    name: string,
  ) => Effect.Effect<void, ScriptPackageStateError>;
  readonly save: (
    value: ManagedScriptPackage,
  ) => Effect.Effect<void, ScriptPackageStateError>;
}

export class ScriptPackageState extends Context.Service<
  ScriptPackageState,
  ScriptPackageStateShape
>()("lucent/desktop/scripting/ScriptPackageState") {}

const invalidState = (message: string): ScriptPackageLoadState => ({
  status: "failed",
  error: new ScriptPackageStateError({
    operation: "load",
    cause: new Error(message),
  }),
});

const hasDuplicateMappings = (
  packages: Iterable<ManagedScriptPackage>,
): boolean => {
  const names = new Set<string>();
  const directories = new Set<string>();
  for (const entry of packages) {
    if (names.has(entry.name) || directories.has(entry.directory)) return true;
    names.add(entry.name);
    directories.add(entry.directory);
  }
  return false;
};

const stateFromUnknown = (value: unknown): ScriptPackageLoadState => {
  const decoded = decodeStateFile(value);
  if (Option.isNone(decoded)) {
    return invalidState("Script package state has an invalid format.");
  }
  const packages =
    decoded.value.version === 2
      ? decoded.value.packages
      : decoded.value.packages.map(fromLegacy);
  if (hasDuplicateMappings(packages)) {
    return invalidState("Script package state contains duplicate mappings.");
  }

  return {
    status: "loaded",
    packages: new Map(packages.map((entry) => [entry.name, entry])),
  };
};

const serializeState = (
  values: ReadonlyMap<string, ManagedScriptPackage>,
): unknown => ({
  version: 2,
  packages: [...values.values()].sort((left, right) =>
    left.name.localeCompare(right.name),
  ),
});

export const layer = Layer.effect(
  ScriptPackageState,
  Effect.gen(function* () {
    const env = yield* DesktopEnvironment;
    const jsonFile = makeJsonFile(yield* FileSystem);
    const statePath = join(env.appDataDir, "script-packages.json");
    const initial = yield* jsonFile.read(statePath).pipe(
      Effect.match({
        onFailure: (cause): ScriptPackageLoadState => ({
          status: "failed",
          error: new ScriptPackageStateError({ operation: "load", cause }),
        }),
        onSuccess: (result): ScriptPackageLoadState =>
          result.status === "missing"
            ? { status: "loaded", packages: new Map() }
            : stateFromUnknown(result.value),
      }),
    );
    if (initial.status === "failed") {
      yield* Effect.logWarning(
        "Failed to load script package state; local packages remain available as unmanaged and package mutations are disabled.",
        Cause.fail(initial.error),
      ).pipe(Effect.annotateLogs({ component: "script-package-state" }));
    }
    const stateRef = yield* SynchronizedRef.make(initial);

    const persist = (state: ReadonlyMap<string, ManagedScriptPackage>) =>
      jsonFile
        .write(statePath, serializeState(state))
        .pipe(
          Effect.mapError(
            (cause) =>
              new ScriptPackageStateError({ operation: "save", cause }),
          ),
        );

    const mutate = (
      update: (
        state: ReadonlyMap<string, ManagedScriptPackage>,
      ) => Map<string, ManagedScriptPackage>,
    ) =>
      SynchronizedRef.updateEffect(stateRef, (loaded) =>
        Effect.gen(function* () {
          if (loaded.status === "failed") return yield* loaded.error;
          const next = update(loaded.packages);
          if (hasDuplicateMappings(next.values())) {
            return yield* new ScriptPackageStateError({
              operation: "save",
              cause: new Error("Script package folders must be unique."),
            });
          }
          yield* persist(next);
          return { status: "loaded", packages: next } as const;
        }),
      );

    return ScriptPackageState.of({
      get: (name) =>
        SynchronizedRef.get(stateRef).pipe(
          Effect.map((state) => {
            if (state.status === "failed") return undefined;
            return state.packages.get(name);
          }),
        ),
      getAll: SynchronizedRef.get(stateRef).pipe(
        Effect.map((state) =>
          state.status === "failed" ? [] : [...state.packages.values()],
        ),
      ),
      remove: (name) =>
        mutate((current) => {
          const next = new Map(current);
          next.delete(name);
          return next;
        }),
      save: (value) =>
        mutate((current) => {
          const next = new Map(current);
          next.set(value.name, value);
          return next;
        }),
    });
  }),
);
