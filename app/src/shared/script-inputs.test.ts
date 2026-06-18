import { describe, expect, it } from "@effect/vitest";
import {
  normalizeScriptInputsDefinition,
  resolveScriptInputValues,
  ScriptInputsValidationError,
} from "./script-inputs";

describe("script inputs", () => {
  it("normalizes valid declarations", () => {
    expect(
      normalizeScriptInputsDefinition({
        id: "author.script",
        fields: [
          {
            key: "target",
            type: "string",
            required: true,
            label: "Target",
            description: "Monster target",
            defaultValue: "wolf",
          },
          {
            key: "server",
            type: "select",
            options: ["Artix", "Yorumi"],
          },
        ],
      }),
    ).toEqual({
      id: "author.script",
      fields: [
        {
          key: "target",
          type: "string",
          required: true,
          label: "Target",
          description: "Monster target",
          defaultValue: "wolf",
        },
        {
          key: "server",
          type: "select",
          options: ["Artix", "Yorumi"],
        },
      ],
    });
  });

  it("rejects malformed declarations", () => {
    expect(() => normalizeScriptInputsDefinition({ fields: [] })).toThrow(
      ScriptInputsValidationError,
    );

    expect(() =>
      normalizeScriptInputsDefinition({
        id: "author.script",
        fields: [
          { key: "target", type: "string" },
          { key: "target", type: "number" },
        ],
      }),
    ).toThrow("duplicate key");

    expect(() =>
      normalizeScriptInputsDefinition({
        id: "author.script",
        fields: [{ key: "server", type: "select", options: [] }],
      }),
    ).toThrow("at least one value");
  });

  it("resolves defaults, saved values, and required misses strictly", () => {
    const definition = normalizeScriptInputsDefinition({
      id: "author.script",
      fields: [
        { key: "target", type: "string", required: true },
        { key: "count", type: "number", defaultValue: 3 },
        { key: "enabled", type: "boolean" },
        { key: "server", type: "select", options: ["Artix"] },
      ],
    });

    expect(
      resolveScriptInputValues(definition, {
        target: 42,
        count: Number.NaN,
        enabled: false,
        server: "Yorumi",
        unknown: "preserved elsewhere",
      }),
    ).toEqual({
      values: { count: 3, enabled: false },
      missingRequiredKeys: ["target"],
    });
  });
});
