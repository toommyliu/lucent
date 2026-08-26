import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import {
  ScriptInputsDefinitionSchema,
  findMissingRequiredScriptInputs,
  normalizeScriptInputValues,
  validateScriptInputValues,
  type ScriptInputsDefinition,
} from "./scriptInputs";

const isScriptInputsDefinition = Schema.is(ScriptInputsDefinitionSchema);

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

  it("reports required fields that remain absent after normalization", () => {
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

  it("normalizes multi-select values in declared option order", () => {
    const multiSelectDefinition = {
      id: "multi-select",
      fields: [
        {
          key: "rewards",
          label: "Rewards",
          type: "multi-select",
          options: ["Weapon", "Armor", "Pet"],
          default: ["Pet", "Armor"],
          required: true,
        },
      ],
    } satisfies ScriptInputsDefinition;

    expect(
      normalizeScriptInputValues(multiSelectDefinition, {
        rewards: ["Pet", "Weapon", "Pet", "Removed"],
      }),
    ).toEqual({ rewards: ["Weapon", "Pet"] });
    expect(normalizeScriptInputValues(multiSelectDefinition, {})).toEqual({
      rewards: ["Armor", "Pet"],
    });
    expect(
      normalizeScriptInputValues(multiSelectDefinition, { rewards: [] }),
    ).toEqual({ rewards: [] });
    expect(
      findMissingRequiredScriptInputs(multiSelectDefinition, { rewards: [] }),
    ).toEqual(["rewards"]);
  });

  it("returns discriminated validation results", () => {
    expect([
      validateScriptInputValues(definition, { name: "Hero" }),
      validateScriptInputValues(definition, {}),
    ]).toEqual([
      {
        status: "ok",
        values: {
          name: "Hero",
          count: 3,
          enabled: true,
          mode: "safe",
        },
      },
      {
        status: "missing-required",
        fieldKeys: ["name"],
        values: {
          count: 3,
          enabled: true,
          mode: "safe",
        },
      },
    ]);
  });

  it("rejects duplicate field keys and invalid select defaults", () => {
    expect(
      isScriptInputsDefinition({
        id: "duplicate",
        fields: [
          { key: "target", label: "Target", type: "string" },
          { key: "target", label: "Other Target", type: "string" },
        ],
      }),
    ).toBe(false);
    expect(
      isScriptInputsDefinition({
        id: "empty-select",
        fields: [
          { key: "server", label: "Server", type: "select", options: [] },
        ],
      }),
    ).toBe(false);
    expect(
      isScriptInputsDefinition({
        id: "invalid-default",
        fields: [
          {
            key: "server",
            label: "Server",
            type: "select",
            options: ["Artix"],
            default: "Yorumi",
          },
        ],
      }),
    ).toBe(false);
    expect(
      isScriptInputsDefinition({
        id: "duplicate-multi-select-options",
        fields: [
          {
            key: "rewards",
            label: "Rewards",
            type: "multi-select",
            options: ["Weapon", "Weapon"],
          },
        ],
      }),
    ).toBe(false);
    expect(
      isScriptInputsDefinition({
        id: "invalid-multi-select-default",
        fields: [
          {
            key: "rewards",
            label: "Rewards",
            type: "multi-select",
            options: ["Weapon"],
            default: ["Armor"],
          },
        ],
      }),
    ).toBe(false);
  });
});
