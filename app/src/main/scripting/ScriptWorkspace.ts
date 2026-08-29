import { join } from "path";

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { DesktopEnvironment } from "../app/DesktopEnvironment";
import {
  DesktopFileSystem,
  DesktopFileSystemError,
  isAlreadyExists,
} from "../filesystem/DesktopFileSystem";
import { resolveScriptWorkspacePaths } from "./ScriptWorkspacePaths";

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

const makeError = (
  operation: typeof scriptWorkspaceOperationSchema.Type,
  path: string,
  cause: unknown,
) => new ScriptWorkspaceError({ operation, path, cause });

export const layer = Layer.effect(
  ScriptWorkspace,
  Effect.gen(function* () {
    const env = yield* DesktopEnvironment;
    const filesystem = yield* DesktopFileSystem;
    const { packagesDir, scriptsDir } = resolveScriptWorkspacePaths(
      env.workspaceDir,
    );
    const configPath = join(env.workspaceDir, "jsconfig.json");
    const typesPath = join(env.workspaceDir, "script-api.d.ts");
    const templatePath = env.isDev
      ? join(env.assetsDir, "..", "docs", "public", "script-api.d.ts")
      : join(env.assetsDir, "..", "script-api.d.ts");

    const createDirectory = (path: string) =>
      filesystem
        .makeDirectory(path, { recursive: true })
        .pipe(
          Effect.mapError((error) =>
            makeError("create-directory", path, error),
          ),
        );

    const createConfig = filesystem
      .writeFile(configPath, SCRIPT_WORKSPACE_CONFIG, { exclusive: true })
      .pipe(
        Effect.mapError((error) =>
          makeError("create-config", configPath, error),
        ),
        Effect.catch((error) =>
          error.cause instanceof DesktopFileSystemError &&
          isAlreadyExists(error.cause)
            ? Effect.void
            : Effect.fail(error),
        ),
      );

    const copyTypes = filesystem
      .copyFile(templatePath, typesPath, { exclusive: true })
      .pipe(
        Effect.mapError((error) => makeError("copy-types", typesPath, error)),
        Effect.catch((error) =>
          error.cause instanceof DesktopFileSystemError &&
          isAlreadyExists(error.cause)
            ? Effect.void
            : Effect.fail(error),
        ),
      );

    return ScriptWorkspace.of({
      initialize: Effect.gen(function* () {
        yield* createDirectory(env.workspaceDir);
        yield* Effect.all(
          [createDirectory(scriptsDir), createDirectory(packagesDir)],
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
