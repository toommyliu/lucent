import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";

import type { ScriptLucentStd } from "./ScriptApi";
import { loadScriptModule, ScriptLoadError } from "./scriptLoader";

const script = Object.freeze({ marker: "script-api" });
const lucent = Object.freeze({
  api: Object.freeze({}),
  features: Object.freeze({}),
  script,
}) as unknown as ScriptLucentStd;

const loadResult = (source: string) =>
  loadScriptModule({ lucent, source }).pipe(
    Effect.match({
      onFailure: (error) => ({ error, ok: false }) as const,
      onSuccess: (value) => ({ ok: true, value }) as const,
    }),
    Effect.runPromise,
  );

describe("scriptLoader", () => {
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
        expected: "Unsupported script import",
        source: 'require("fs"); module.exports = function* run() {};',
      },
      {
        expected: "Script failed to load",
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
});
