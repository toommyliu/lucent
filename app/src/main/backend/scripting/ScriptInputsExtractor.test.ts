import { describe, expect, it } from "@effect/vitest";
import {
  extractScriptInputsDefinition,
  ScriptInputsExtractionError,
} from "./ScriptInputsExtractor";

describe("ScriptInputsExtractor", () => {
  it("returns undefined when no inputs declaration exists", () => {
    expect(
      extractScriptInputsDefinition(
        "module.exports = function* run() {};",
        "x",
      ),
    ).toBeUndefined();
  });

  it("extracts a static JSON-like literal declaration", () => {
    expect(
      extractScriptInputsDefinition(
        `
          module.exports = function* run() {};
          module.exports.inputs = {
            id: "author.script",
            fields: [
              {
                key: "target",
                type: "string",
                required: true,
                label: "Target",
                description: "Monster or item",
                defaultValue: "wolf",
              },
              {
                key: "server",
                type: "select",
                options: ["Artix", "Yorumi"],
              },
            ],
          };
        `,
        "valid.js",
      ),
    ).toEqual({
      id: "author.script",
      fields: [
        {
          key: "target",
          type: "string",
          required: true,
          label: "Target",
          description: "Monster or item",
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

  it("rejects dynamic declarations", () => {
    expect(() =>
      extractScriptInputsDefinition(
        "module.exports.inputs = buildInputs();",
        "dynamic.js",
      ),
    ).toThrow(ScriptInputsExtractionError);
  });

  it("rejects computed object keys and duplicate assignments", () => {
    expect(() =>
      extractScriptInputsDefinition(
        `
          const id = "id";
          module.exports.inputs = { [id]: "author.script", fields: [] };
        `,
        "computed.js",
      ),
    ).toThrow("object keys must be static");

    expect(() =>
      extractScriptInputsDefinition(
        `
          module.exports.inputs = { id: "author.script", fields: [] };
          module.exports.inputs = { id: "author.script.other", fields: [] };
        `,
        "duplicate.js",
      ),
    ).toThrow("must only be assigned once");
  });

  it("rejects invalid schemas", () => {
    expect(() =>
      extractScriptInputsDefinition(
        "module.exports.inputs = { fields: [] };",
        "missing-id.js",
      ),
    ).toThrow("inputs.id");

    expect(() =>
      extractScriptInputsDefinition(
        `
          module.exports.inputs = {
            id: "author.script",
            fields: [{ key: "target", type: "object" }],
          };
        `,
        "invalid-type.js",
      ),
    ).toThrow("type must be one of");

    expect(() =>
      extractScriptInputsDefinition(
        `
          module.exports.inputs = {
            id: "author.script",
            fields: [{ key: "server", type: "select", options: ["Artix", 1] }],
          };
        `,
        "invalid-options.js",
      ),
    ).toThrow("options[1]");
  });
});
