import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import type { ScriptLucentStd } from "./ScriptApi";
import type {
  ScriptExecutionPackage,
  ScriptExecutionSnapshot,
  ScriptModuleSource,
} from "@lucent/core/scriptPackages";
import {
  loadScriptModule,
  sanitizeScriptSourceUrl,
  ScriptLoadError,
} from "./scriptLoader";

const script = Object.freeze({ marker: "script-api" });
const lucent = Object.freeze({
  api: Object.freeze({}),
  features: Object.freeze({}),
  script,
}) as unknown as ScriptLucentStd;

const loadResult = (
  source: string,
  options: {
    readonly runtime?: ScriptLucentStd;
    readonly snapshot?: ScriptExecutionSnapshot;
  } = {},
) =>
  loadScriptModule({
    lucent: options.runtime ?? lucent,
    source,
    ...(options.snapshot === undefined ? {} : { snapshot: options.snapshot }),
  }).pipe(
    Effect.match({
      onFailure: (error) => ({ error, ok: false }) as const,
      onSuccess: (value) => ({ ok: true, value }) as const,
    }),
    Effect.runPromise,
  );

describe("scriptLoader", () => {
  const module = (
    id: string,
    path: string,
    source: string,
    options: {
      readonly format?: ScriptModuleSource["format"];
      readonly packageName?: string;
    } = {},
  ): ScriptModuleSource => ({
    format: options.format ?? "commonjs",
    id,
    localPath: `/workspace/${path}`,
    path,
    ...(options.packageName === undefined
      ? {}
      : { packageName: options.packageName }),
    revision: `${id}-revision`,
    source,
  });

  const snapshot = (
    modules: readonly ScriptModuleSource[],
    packages: readonly ScriptExecutionPackage[] = [],
  ): ScriptExecutionSnapshot => ({
    entryModuleId: "entry",
    modules,
    packages,
    revision: "snapshot-revision",
  });

  it("uses the content revision to distinguish source URLs", () => {
    expect(sanitizeScriptSourceUrl("/scripts/farm.js", "abc123")).toBe(
      "lucent-script://farm.js?v=abc123",
    );
    expect(sanitizeScriptSourceUrl("/scripts/farm.js")).toBe(
      "lucent-script://farm.js",
    );
  });

  it("loads generator exports with the supported module facades", async () => {
    const result = await loadResult(`
      const lucent = require("lucent");
      const { Effect } = require("effect");
      module.exports = function* run() {
        return [lucent.script.marker, typeof Effect.succeed];
      };
    `);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.main().next()).toEqual({
        done: true,
        value: ["script-api", "function"],
      });
    }
  });

  it("rejects plain exports, blocked imports, and malformed source", async () => {
    const cases = [
      {
        expected: "generator function",
        source: "module.exports = function run() {};",
      },
      {
        expected: "Script import was not found",
        source: 'require("fs"); module.exports = function* run() {};',
      },
      {
        expected: "failed to load",
        source: "module.exports = function* (",
      },
    ];

    for (const testCase of cases) {
      const result = await loadResult(testCase.source);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(ScriptLoadError);
        expect(result.error.message).toContain(testCase.expected);
      }
    }
  });

  it("resolves relative modules, extension fallbacks, and exact deep package names", async () => {
    const execution = snapshot(
      [
        module(
          "entry",
          "farm.js",
          `
            const helper = require("./lib/helper");
            const tools = require("@a/b/c/d");
            module.exports = function* run() {
              return [helper.value, tools.value];
            };
          `,
        ),
        module("helper", "lib/helper.js", 'exports.value = "relative";'),
        module("tools", "index.cjs", 'exports.value = "package";', {
          packageName: "@a/b/c/d",
        }),
      ],
      [
        {
          compatibility: { status: "unknown", currentVersion: "1.0.0" },
          mainModuleId: "tools",
          name: "@a/b/c/d",
          rootPath: "/workspace/packages/@a/b/c/d",
        },
      ],
    );

    const result = await loadResult("", { snapshot: execution });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.main().next().value).toEqual(["relative", "package"]);
    }
  });

  it("uses one CommonJS module cache per execution and supports cycles", async () => {
    const execution = snapshot([
      module(
        "entry",
        "entry.js",
        `
          const a = require("./a");
          const again = require("./a.js");
          module.exports = function* run() {
            return [a.fromB, a.loads, a === again];
          };
        `,
      ),
      module(
        "a",
        "a.js",
        `
          exports.loads = 1;
          const b = require("./b");
          exports.fromB = b.value;
        `,
      ),
      module(
        "b",
        "b.js",
        `
          const a = require("./a");
          exports.value = a.loads === 1 ? "cycle" : "broken";
        `,
      ),
    ]);

    const first = await loadResult("", { snapshot: execution });
    const second = await loadResult("", { snapshot: execution });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.value.main().next().value).toEqual(["cycle", 1, true]);
      expect(second.value.main().next().value).toEqual(["cycle", 1, true]);
    }
  });

  it("compiles modules lazily and reports unsupported package ESM when imported", async () => {
    const unused = snapshot([
      module(
        "entry",
        "entry.js",
        "module.exports = function* run() { return 'ok'; };",
      ),
      module("broken", "broken.js", "module.exports = function( {"),
    ]);
    const unusedResult = await loadResult("", { snapshot: unused });
    expect(unusedResult.ok).toBe(true);

    const esm = snapshot(
      [
        module(
          "entry",
          "entry.js",
          'require("tools"); module.exports = function* run() {};',
        ),
        module("tools", "index.js", "export const value = 1;", {
          format: "unsupported-esm",
          packageName: "tools",
        }),
      ],
      [
        {
          compatibility: { status: "unknown", currentVersion: "1.0.0" },
          mainModuleId: "tools",
          name: "tools",
          rootPath: "/workspace/packages/tools",
        },
      ],
    );
    const esmResult = await loadResult("", { snapshot: esm });
    expect(esmResult.ok).toBe(false);
    if (!esmResult.ok) {
      expect(esmResult.error.message).toContain("ES module");
      expect(esmResult.error.modulePath).toBe("/workspace/index.js");
    }
  });

  it("includes the importer chain for missing nested imports", async () => {
    const execution = snapshot([
      module(
        "entry",
        "scripts/farm.js",
        'require("../lib/quests"); module.exports = function* run() {};',
        { packageName: "tools" },
      ),
      module("quests", "lib/quests.js", 'require("./quest-data");', {
        packageName: "tools",
      }),
    ]);
    const result = await loadResult("", { snapshot: execution });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("scripts/farm.js");
      expect(result.error.message).toContain("lib/quests.js");
      expect(result.error.message).toContain("quest-data");
    }
  });
});
