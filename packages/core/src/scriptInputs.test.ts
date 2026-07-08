import { describe, expect, it } from "@effect/vitest";

import {
  findMissingRequiredScriptInputs,
  normalizeScriptInputValues,
  validateScriptInputValues,
  type ScriptInputsDefinition,
} from "./scriptInputs";

const definition = {
  id: "sample",
  fields: [
    {
      key: "name",
      label: "Name",
      type: "string",
      required: true,
    },
    {
      key: "count",
      label: "Count",
      type: "number",
      default: 3,
    },
    {
      key: "enabled",
      label: "Enabled",
      type: "boolean",
      default: true,
    },
    {
      key: "mode",
      label: "Mode",
      type: "select",
      options: ["fast", "safe"],
      default: "safe",
    },
  ],
} satisfies ScriptInputsDefinition;

describe("scriptInputs", () => {
  it("normalizes matching values and applies defaults", () => {
    expect(
      normalizeScriptInputValues(definition, {
        name: "Hero",
        count: "not-a-number",
        enabled: false,
        mode: "fast",
        extra: "ignored",
      }),
    ).toEqual({
      name: "Hero",
      count: 3,
      enabled: false,
      mode: "fast",
    });
  });

  it("finds required fields that are absent after normalization", () => {
    const values = normalizeScriptInputValues(definition, {
      count: 7,
      mode: "unknown",
    });

    expect(values).toEqual({
      count: 7,
      enabled: true,
      mode: "safe",
    });
    expect(findMissingRequiredScriptInputs(definition, values)).toEqual([
      "name",
    ]);
  });

  it("returns ok validation results when required values are present", () => {
    expect(validateScriptInputValues(definition, { name: "Hero" })).toEqual({
      status: "ok",
      values: {
        name: "Hero",
        count: 3,
        enabled: true,
        mode: "safe",
      },
    });
  });

  it("returns missing-required validation results", () => {
    expect(validateScriptInputValues(definition, {})).toEqual({
      status: "missing-required",
      fieldKeys: ["name"],
      values: {
        count: 3,
        enabled: true,
        mode: "safe",
      },
    });
  });
});
