import { join } from "path";

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import {
  ScriptPackageRevisionSchema,
  ScriptPackageSourceSchema,
  ScriptPackageUpdateStateSchema,
  type ScriptPackageRevision,
  type ScriptPackageSource,
  type ScriptPackageUpdateState,
} from "@lucent/core/scriptPackages";
import { DesktopEnvironment } from "../app/DesktopEnvironment";
import { readJsonFile, writeJsonFile } from "../settings/JsonFile";

const FileHashesSchema = Schema.Record(Schema.String, Schema.String);

const ManagedScriptPackageSchema = Schema.Struct({
  name: Schema.String,
  installedAt: Schema.String,
  files: FileHashesSchema,
  source: ScriptPackageSourceSchema,
  etag: Schema.optionalKey(Schema.String),
  remoteRevision: Schema.optionalKey(ScriptPackageRevisionSchema),
  update: Schema.optionalKey(ScriptPackageUpdateStateSchema),
});

const ScriptPackageStateFileSchema = Schema.Struct({
  version: Schema.Literal(1),
  packages: Schema.Array(ManagedScriptPackageSchema),
});

const decodeStateFile = Schema.decodeUnknownOption(
  ScriptPackageStateFileSchema,
);

export interface ManagedScriptPackage {
  readonly name: string;
  readonly installedAt: string;
  readonly files: Readonly<Record<string, string>>;
  readonly source: ScriptPackageSource;
  /** ETag for a repository-root commit lookup. */
  readonly etag?: string;
  /** Revision returned by the most recent successful update lookup. */
  readonly remoteRevision?: ScriptPackageRevision;
  readonly update?: ScriptPackageUpdateState;
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

export class ScriptPackageStateError extends Schema.TaggedErrorClass<ScriptPackageStateError>()(
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

const cloneRecord = (value: ManagedScriptPackage): ManagedScriptPackage => ({
  ...value,
  files: { ...value.files },
  source: { ...value.source },
  ...(value.update === undefined ? {} : { update: { ...value.update } }),
});

const stateFromUnknown = (value: unknown): ScriptPackageLoadState => {
  const decoded = decodeStateFile(value);
  if (Option.isNone(decoded)) {
    return {
      status: "failed",
      error: new ScriptPackageStateError({
        operation: "load",
        cause: new Error("Script package state has an invalid format."),
      }),
    };
  }

  return {
    status: "loaded",
    packages: new Map(
      decoded.value.packages.map((entry) => [entry.name, cloneRecord(entry)]),
    ),
  };
};

const serializeState = (
  values: ReadonlyMap<string, ManagedScriptPackage>,
): unknown => ({
  version: 1,
  packages: [...values.values()]
    .map(cloneRecord)
    .sort((left, right) => left.name.localeCompare(right.name)),
});

export const layer = Layer.effect(
  ScriptPackageState,
  Effect.gen(function* () {
    const env = yield* DesktopEnvironment;
    const statePath = join(env.appDataDir, "script-packages.json");
    const initial = yield* readJsonFile(statePath).pipe(
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
      yield* Effect.logWarning({
        message:
          "Failed to load script package state; local packages remain available as unmanaged and package mutations are disabled.",
        cause: initial.error,
      });
    }
    const stateRef = yield* Ref.make(initial);
    const writeGate = yield* Semaphore.make(1);

    const persist = (state: ReadonlyMap<string, ManagedScriptPackage>) =>
      writeJsonFile(statePath, serializeState(state)).pipe(
        Effect.mapError(
          (cause) => new ScriptPackageStateError({ operation: "save", cause }),
        ),
      );

    const mutate = (
      update: (
        state: ReadonlyMap<string, ManagedScriptPackage>,
      ) => Map<string, ManagedScriptPackage>,
    ) =>
      writeGate.withPermits(1)(
        Effect.gen(function* () {
          const loaded = yield* Ref.get(stateRef);
          if (loaded.status === "failed") return yield* loaded.error;
          const next = update(loaded.packages);
          yield* persist(next);
          yield* Ref.set(stateRef, { status: "loaded", packages: next });
        }),
      );

    return ScriptPackageState.of({
      get: (name) =>
        Ref.get(stateRef).pipe(
          Effect.map((state) => {
            if (state.status === "failed") return undefined;
            const value = state.packages.get(name);
            return value === undefined ? undefined : cloneRecord(value);
          }),
        ),
      getAll: Ref.get(stateRef).pipe(
        Effect.map((state) =>
          state.status === "failed"
            ? []
            : [...state.packages.values()].map(cloneRecord),
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
          next.set(value.name, cloneRecord(value));
          return next;
        }),
    });
  }),
);
