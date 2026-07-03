import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";

import type { ScriptLucentStd } from "./ScriptApi";
import { loadScriptModule, ScriptLoadError } from "./scriptLoader";

const lucent = Object.freeze({
  api: Object.freeze({}),
  features: Object.freeze({}),
  script: Object.freeze({}),
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
  it("accepts generator function exports", async () => {
    const result = await loadResult(`
      module.exports = function* run() {};
    `);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.main.constructor.name).toBe("GeneratorFunction");
    }
  });

  it("rejects non-generator exports", async () => {
    const result = await loadResult(`
      module.exports = function run() {};
    `);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(ScriptLoadError);
      expect(result.error.message).toContain("generator function");
    }
  });

  it("only allows lucent and effect imports", async () => {
    const result = await loadResult(`
      require("fs");
      module.exports = function* run() {};
    `);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(ScriptLoadError);
      expect(result.error.message).toContain("Unsupported script import");
    }
  });
});
