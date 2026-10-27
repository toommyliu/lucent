import { beforeEach, describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import { vi } from "vitest";

import { DesktopEnvironment } from "../../app/DesktopEnvironment";
import { ElectronDialog } from "../../electron/ElectronDialog";
import { layer as shellLayer } from "../../electron/ElectronShell";
import { layer as libraryLayer } from "../../scripting/DesktopScriptLibrary";
import type { DiscoveredScriptCatalog } from "../../scripting/ScriptCatalogDiscovery";
import {
  ScriptPackageCatalog,
  ScriptPackageCatalogError,
} from "../../scripting/ScriptPackageCatalog";
import { ScriptSourceRegistry } from "../../scripting/ScriptSourceRegistry";
import { makeLifetime } from "../../window/RendererLifetimeTesting";
import { openPath } from "./scripting";

const shell = vi.hoisted(() => ({
  openPath: vi.fn(),
  showItemInFolder: vi.fn(),
}));
vi.mock("electron", () => ({ shell, ipcMain: {} }));

const discovery: DiscoveredScriptCatalog = {
  catalog: {
    packages: [
      {
        status: "valid",
        name: "tools",
        path: "/workspace/packages/tools",
        compatibility: {
          status: "compatible",
          currentVersion: "1.0.0",
          requiredVersion: "^1.0.0",
        },
        dependencyStatus: { status: "ready" },
        integrity: "verified",
        update: { status: "unchecked" },
      },
      {
        status: "invalid",
        path: "/workspace/packages/broken",
        diagnostic: "This folder does not contain a package.json.",
      },
    ],
    revision: "initial",
    scripts: [
      {
        name: "run.js",
        path: "/workspace/scripts/run.js",
        reference: { kind: "loose", path: "run.js" },
        relativePath: "run.js",
      },
      {
        name: "farm.js",
        path: "/workspace/packages/tools/scripts/farm.js",
        packageName: "tools",
        reference: {
          kind: "package",
          packageName: "tools",
          path: "scripts/farm.js",
        },
        relativePath: "farm.js",
      },
    ],
  },
  paths: new Map([
    ["/workspace/scripts/run.js", { kind: "loose", path: "run.js" }],
    [
      "/workspace/packages/tools/scripts/farm.js",
      { kind: "package", packageName: "tools", path: "scripts/farm.js" },
    ],
  ]),
  packages: new Map(),
  scripts: new Map(),
};

const makeLayer = (
  getDiscovery: ScriptPackageCatalog["Service"]["getDiscovery"] = Effect.succeed(
    discovery,
  ),
) =>
  libraryLayer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(DesktopEnvironment, {
          appDataDir: "/app-data",
          assetsDir: "/assets",
          isDev: false,
          platform: "darwin",
          workspaceDir: "/workspace",
        }),
        Layer.mock(ElectronDialog, {}),
        FileSystem.layerNoop({}),
        Layer.mock(ScriptPackageCatalog, { getDiscovery }),
        Layer.mock(ScriptSourceRegistry, {}),
        shellLayer,
      ),
    ),
  );

const sender = {
  kind: "game",
  rendererId: 42,
  lifetime: makeLifetime(42),
} as const;

beforeEach(() => {
  vi.clearAllMocks();
  shell.openPath.mockResolvedValue("");
});

describe("scripting.openPath IPC", () => {
  it.effect.each([
    ["/Applications/Calculator.app", "/Applications/Calculator.app"],
    ["/outside/picked.js", "/outside/picked.js"],
    ["/workspace/scripts/uncatalogued.js", "/workspace/scripts/uncatalogued.js"],
    [
      "/workspace/packages/tools/Terminal.app",
      "/workspace/packages/tools/Terminal.app",
    ],
    ["/workspace/packages/tools-other", "/workspace/packages/tools-other"],
    [
      "/workspace/packages/tools/../../../Applications/Calculator.app",
      "/Applications/Calculator.app",
    ],
  ] as const)(
    "reveals an uncatalogued path without opening it: %s",
    ([path, target]) =>
      Effect.gen(function* () {
        const result = yield* openPath.handler({ path }, sender);

        expect(shell.openPath.mock.calls).toEqual([]);
        expect(shell.showItemInFolder.mock.calls).toEqual([[target]]);
        expect(result).toBe(true);
      }).pipe(Effect.provide(makeLayer())),
  );

  it.effect.each([
    ["/workspace/scripts/run.js", "/workspace/scripts/run.js"],
    ["/workspace/scripts/../scripts/run.js", "/workspace/scripts/run.js"],
    [
      "/workspace/packages/tools/scripts/farm.js",
      "/workspace/packages/tools/scripts/farm.js",
    ],
    ["/workspace/packages/tools/.", "/workspace/packages/tools"],
    ["/workspace/packages/broken", "/workspace/packages/broken"],
  ] as const)(
    "opens a catalog script or discovered package folder: %s",
    ([path, target]) =>
      Effect.gen(function* () {
        const result = yield* openPath.handler({ path }, sender);

        expect(shell.openPath.mock.calls).toEqual([[target]]);
        expect(shell.showItemInFolder.mock.calls).toEqual([]);
        expect(result).toBe(true);
      }).pipe(Effect.provide(makeLayer())),
  );

  it.effect("uses the current discovery after a catalog change", () => {
    let current = discovery;
    return Effect.gen(function* () {
      yield* openPath.handler({ path: "/workspace/scripts/run.js" }, sender);
      current = {
        ...discovery,
        catalog: { packages: [], scripts: [], revision: "removed" },
        paths: new Map(),
      };
      yield* openPath.handler({ path: "/workspace/scripts/run.js" }, sender);
      yield* openPath.handler({ path: "/workspace/packages/tools" }, sender);

      expect(shell.openPath.mock.calls).toEqual([["/workspace/scripts/run.js"]]);
      expect(shell.showItemInFolder.mock.calls).toEqual([
        ["/workspace/scripts/run.js"],
        ["/workspace/packages/tools"],
      ]);
    }).pipe(Effect.provide(makeLayer(Effect.sync(() => current))));
  });

  it.effect("reveals the path when catalog discovery fails", () =>
    Effect.gen(function* () {
      const result = yield* openPath.handler(
        { path: "/Applications/Calculator.app" },
        sender,
      );

      expect(shell.openPath.mock.calls).toEqual([]);
      expect(shell.showItemInFolder.mock.calls).toEqual([
        ["/Applications/Calculator.app"],
      ]);
      expect(result).toBe(true);
    }).pipe(
      Effect.provide(
        makeLayer(
          Effect.fail(
            new ScriptPackageCatalogError({
              operation: "scan",
              cause: new Error("Catalog unavailable"),
            }),
          ),
        ),
      ),
    ),
  );
});
