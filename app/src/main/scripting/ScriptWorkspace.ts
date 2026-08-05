import { constants, promises as fs } from "fs";
import { join } from "path";

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { DesktopEnvironment } from "../app/DesktopEnvironment";

const scriptWorkspaceOperationSchema = Schema.Literals([
  "copy-types",
  "create-config",
  "create-directory",
]);

export class ScriptWorkspaceError extends Schema.TaggedErrorClass<ScriptWorkspaceError>()(
  "ScriptWorkspaceError",
  {
    operation: scriptWorkspaceOperationSchema,
    path: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Script workspace ${this.operation} failed at ${this.path}.`;
  }
}

export interface ScriptWorkspaceShape {
  readonly initialize: Effect.Effect<void, ScriptWorkspaceError>;
}

export class ScriptWorkspace extends Context.Service<
  ScriptWorkspace,
  ScriptWorkspaceShape
>()("lucent/desktop/scripting/ScriptWorkspace") {}

export const SCRIPT_WORKSPACE_CONFIG = `${JSON.stringify(
  {
    compilerOptions: {
      target: "ES2020",
      module: "CommonJS",
      moduleResolution: "Node",
      lib: ["ES2020", "DOM"],
      checkJs: false,
      skipLibCheck: true,
      baseUrl: "./packages",
    },
    include: [
      "script-api.d.ts",
      "scripts/**/*.js",
      "scripts/**/*.cjs",
      "scripts/**/*.d.ts",
      "packages/**/*.js",
      "packages/**/*.cjs",
      "packages/**/*.d.ts",
    ],
  },
  null,
  2,
)}\n`;

const isAlreadyPresent = (cause: unknown): boolean =>
  cause instanceof Error &&
  "code" in cause &&
  (cause as { readonly code?: unknown }).code === "EEXIST";

const makeError = (
  operation: typeof scriptWorkspaceOperationSchema.Type,
  path: string,
  cause: unknown,
) => new ScriptWorkspaceError({ operation, path, cause });

export const layer = Layer.effect(
  ScriptWorkspace,
  Effect.gen(function* () {
    const env = yield* DesktopEnvironment;
    const configPath = env.workspacePath("jsconfig.json");
    const typesPath = env.workspacePath("script-api.d.ts");
    const templatePath = env.isDev
      ? join(env.assetsDir, "..", "docs", "public", "script-api.d.ts")
      : join(env.assetsDir, "..", "script-api.d.ts");

    const createDirectory = (path: string) =>
      Effect.tryPromise({
        try: () => fs.mkdir(path, { recursive: true }),
        catch: (cause) => makeError("create-directory", path, cause),
      }).pipe(Effect.asVoid);

    const createConfig = Effect.tryPromise({
      try: () =>
        fs.writeFile(configPath, SCRIPT_WORKSPACE_CONFIG, {
          encoding: "utf8",
          flag: "wx",
        }),
      catch: (cause) => makeError("create-config", configPath, cause),
    }).pipe(
      Effect.catch((error) =>
        isAlreadyPresent(error.cause) ? Effect.void : Effect.fail(error),
      ),
    );

    const copyTypes = Effect.tryPromise({
      try: () => fs.copyFile(templatePath, typesPath, constants.COPYFILE_EXCL),
      catch: (cause) => makeError("copy-types", typesPath, cause),
    }).pipe(
      Effect.catch((error) =>
        isAlreadyPresent(error.cause) ? Effect.void : Effect.fail(error),
      ),
    );

    return ScriptWorkspace.of({
      initialize: Effect.gen(function* () {
        yield* createDirectory(env.workspaceDir);
        yield* Effect.all(
          [createDirectory(env.scriptsDir), createDirectory(env.packagesDir)],
          { concurrency: 2, discard: true },
        );
        yield* Effect.all([createConfig, copyTypes], {
          concurrency: 2,
          discard: true,
        });
      }),
    });
  }),
);
