import { promises as fs } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";

import { afterEach, describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
  makeScriptFiles,
  ScriptFiles,
} from "../internal/scripting/ScriptFiles";
import { processScriptFile } from "../internal/scripting/ScriptFileWorker";
import {
  discoverScriptCatalog,
  type DiscoveredScriptCatalog,
  ScriptPackageCatalog,
} from "./ScriptPackageCatalog";
import {
  discoverLiteralScriptRequirements,
  layer as scriptSourceRegistryLayer,
  ScriptSourceRegistry,
} from "./ScriptSourceRegistry";

const directories: string[] = [];

const write = async (path: string, source: string): Promise<void> => {
  await fs.mkdir(dirname(path), { recursive: true });
  await fs.writeFile(path, source, "utf8");
};

const makeWorkspace = async () => {
  const root = await fs.mkdtemp(join(tmpdir(), "lucent-script-sources-"));
  directories.push(root);
  const scriptsDir = join(root, "scripts");
  const packagesDir = join(root, "packages");
  await Promise.all([
    fs.mkdir(scriptsDir, { recursive: true }),
    fs.mkdir(packagesDir, { recursive: true }),
  ]);
  return { packagesDir, scriptsDir };
};

const makeLayer = (discovery: DiscoveredScriptCatalog) => {
  const overview = {
    packages: discovery.catalog.packages,
    revision: discovery.catalog.revision,
    scriptCount: discovery.catalog.scripts.length,
  };
  const catalog = ScriptPackageCatalog.of({
    getDiscovery: Effect.succeed(discovery),
    getOverview: Effect.succeed(overview),
    getPage: (request) =>
      Effect.succeed({
        entries: discovery.catalog.scripts.slice(
          request.offset,
          request.offset + request.limit,
        ),
        offset: request.offset,
        revision: discovery.catalog.revision,
        total: discovery.catalog.scripts.length,
      }),
    onChanged: () => Effect.succeed(() => undefined),
    referenceForPath: (path) => Effect.succeed(discovery.paths.get(path)),
    refresh: Effect.succeed(overview),
    removePackage: () => Effect.succeed(overview),
    replacePackage: () => Effect.succeed(overview),
    resolveReference: (reference) =>
      Effect.succeed(
        discovery.scripts.get(
          reference.kind === "loose"
            ? `loose:${reference.path}`
            : `package:${reference.packageName}:${reference.path}`,
        ),
      ),
    updateManagedPackage: () => Effect.succeed(overview),
  });
  return scriptSourceRegistryLayer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(ScriptPackageCatalog, catalog),
        Layer.succeed(
          ScriptFiles,
          makeScriptFiles((path) => processScriptFile(path)),
        ),
      ),
    ),
  );
};

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => fs.rm(path, { recursive: true, force: true })),
  );
});

describe("script source dependency discovery", () => {
  it("finds only direct string-literal require calls", () => {
    expect(
      discoverLiteralScriptRequirements(`
        require("./direct");
        require("./direct");
        const path = "./computed";
        require(path);
        const load = require;
        load("./aliased");
        require(\`./template\`);
      `),
    ).toEqual(["./direct"]);
    expect(discoverLiteralScriptRequirements("function (")).toEqual([]);
  });

  it.effect(
    "collects relative, package, and cyclic reachable modules only",
    () =>
      Effect.gen(function* () {
        const workspace = yield* Effect.promise(makeWorkspace);
        yield* Effect.promise(() =>
          Promise.all([
            write(
              join(workspace.scriptsDir, "entry.js"),
              `
              require("lucent/api");
              require("lucent/autorelogin");
              require("lucent/autozone");
              require("lucent/script");
              require("effect");
              require("./lib/helper");
              require("tools");
              module.exports = function* run() {};
            `,
            ),
            write(
              join(workspace.scriptsDir, "lib", "helper.js"),
              'require("./cycle"); exports.value = 1;',
            ),
            write(
              join(workspace.scriptsDir, "lib", "cycle.js"),
              'require("./helper"); exports.value = 2;',
            ),
            write(
              join(workspace.scriptsDir, "unrelated.js"),
              "throw new Error('must not be snapshotted');",
            ),
            write(
              join(workspace.packagesDir, "tools", "package.json"),
              '{"name":"tools","main":"index.js"}',
            ),
            write(
              join(workspace.packagesDir, "tools", "index.js"),
              'require("./lib/value"); exports.value = 1;',
            ),
            write(
              join(workspace.packagesDir, "tools", "lib", "value.js"),
              "exports.value = 2;",
            ),
            write(
              join(workspace.packagesDir, "tools", "lib", "unrelated.js"),
              "throw new Error('must not be snapshotted');",
            ),
          ]),
        );
        const discovery = yield* Effect.promise(() =>
          discoverScriptCatalog({
            currentVersion: "1.0.0",
            packagesDir: workspace.packagesDir,
            scriptsDir: workspace.scriptsDir,
          }),
        );
        const registry = yield* ScriptSourceRegistry.pipe(
          Effect.provide(makeLayer(discovery)),
        );

        const file = yield* registry.readReference({
          kind: "loose",
          path: "entry.js",
        });

        expect(file.snapshot?.modules.map((module) => module.id)).toEqual([
          "loose:entry.js",
          "loose:lib/cycle.js",
          "loose:lib/helper.js",
          "package:tools:index.js",
          "package:tools:lib/value.js",
        ]);
        expect(file.snapshot?.packages.map((entry) => entry.name)).toEqual([
          "tools",
        ]);
      }),
  );

  it.effect("keeps missing, malformed, and computed dependencies lazy", () =>
    Effect.gen(function* () {
      const workspace = yield* Effect.promise(makeWorkspace);
      yield* Effect.promise(() =>
        Promise.all([
          write(
            join(workspace.scriptsDir, "entry.js"),
            `
              if (false) require("./missing");
              if (false) require("./malformed");
              const computed = "./computed";
              if (false) require(computed);
              module.exports = function* run() {};
            `,
          ),
          write(
            join(workspace.scriptsDir, "malformed.js"),
            "module.exports = function( {",
          ),
          write(
            join(workspace.scriptsDir, "computed.js"),
            "exports.value = 1;",
          ),
        ]),
      );
      const discovery = yield* Effect.promise(() =>
        discoverScriptCatalog({
          currentVersion: "1.0.0",
          packagesDir: workspace.packagesDir,
          scriptsDir: workspace.scriptsDir,
        }),
      );
      const registry = yield* ScriptSourceRegistry.pipe(
        Effect.provide(makeLayer(discovery)),
      );

      const file = yield* registry.readReference({
        kind: "loose",
        path: "entry.js",
      });

      expect(file.snapshot?.modules.map((module) => module.id)).toEqual([
        "loose:entry.js",
        "loose:malformed.js",
      ]);
    }),
  );
});
