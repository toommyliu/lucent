import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";

import {
  ScriptInputsExtractor,
  ScriptInputsExtractorError,
  layer as scriptInputsExtractorLayer,
} from "./ScriptInputsExtractor";

const extractInputs = (source: string, fallbackId = "fallback-script-id") =>
  Effect.gen(function* () {
    const extractor = yield* ScriptInputsExtractor;
    return yield* extractor.extract(source, fallbackId);
  }).pipe(Effect.provide(scriptInputsExtractorLayer));

const extractInputsResult = (source: string) =>
  extractInputs(source).pipe(
    Effect.match({
      onFailure: (error) => ({ error, ok: false }) as const,
      onSuccess: (value) => ({ ok: true, value }) as const,
    }),
  );

describe("ScriptInputsExtractor", () => {
  it.effect("extracts static inputs and fills a missing id", () =>
    Effect.gen(function* () {
      const definition = yield* extractInputs(`
        module.exports = function* run() {};
        module.exports.inputs = {
          fields: [
            {
              key: "enabled",
              type: "boolean",
              label: "Enabled",
              default: false,
            },
          ],
        };
      `);

      expect(definition).toEqual({
        id: "fallback-script-id",
        fields: [
          {
            key: "enabled",
            type: "boolean",
            label: "Enabled",
            default: false,
          },
        ],
      });
    }),
  );

  it.effect("rejects duplicate field keys", () =>
    Effect.gen(function* () {
      const result = yield* extractInputsResult(`
        module.exports.inputs = {
          id: "duplicate-fields",
          fields: [
            { key: "target", type: "string", label: "Target" },
            { key: "target", type: "string", label: "Target Again" },
          ],
        };
      `);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(ScriptInputsExtractorError);
        expect(result.error.message).toContain("Duplicate script input key");
      }
    }),
  );

  it.effect("rejects dynamic, spread, and computed input definitions", () =>
    Effect.gen(function* () {
      const dynamic = yield* extractInputsResult(`
        const fields = [];
        module.exports.inputs = { id: "dynamic", fields };
      `);
      const spread = yield* extractInputsResult(`
        module.exports.inputs = { id: "spread", fields: [], ...extra };
      `);
      const computed = yield* extractInputsResult(`
        module.exports.inputs = { id: "computed", ["fields"]: [] };
      `);

      expect(dynamic.ok).toBe(false);
      expect(spread.ok).toBe(false);
      expect(computed.ok).toBe(false);
    }),
  );
});
