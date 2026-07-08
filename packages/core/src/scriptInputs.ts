import { Schema } from "effect";

export const ScriptInputValueSchema = Schema.Union([
  Schema.String,
  Schema.Number,
  Schema.Boolean,
]);

export type ScriptInputValue = typeof ScriptInputValueSchema.Type;

export const ScriptInputTypeSchema = Schema.Literals([
  "string",
  "number",
  "boolean",
  "select",
]);

export type ScriptInputType = typeof ScriptInputTypeSchema.Type;

const ScriptInputFieldBaseSchema = {
  key: Schema.String,
  label: Schema.String,
  description: Schema.optionalKey(Schema.String),
  required: Schema.optionalKey(Schema.Boolean),
} as const;

export const ScriptStringInputFieldSchema = Schema.Struct({
  ...ScriptInputFieldBaseSchema,
  type: Schema.Literal("string"),
  default: Schema.optionalKey(Schema.String),
});

export const ScriptNumberInputFieldSchema = Schema.Struct({
  ...ScriptInputFieldBaseSchema,
  type: Schema.Literal("number"),
  default: Schema.optionalKey(Schema.Number),
});

export const ScriptBooleanInputFieldSchema = Schema.Struct({
  ...ScriptInputFieldBaseSchema,
  type: Schema.Literal("boolean"),
  default: Schema.optionalKey(Schema.Boolean),
});

export const ScriptSelectInputFieldSchema = Schema.Struct({
  ...ScriptInputFieldBaseSchema,
  type: Schema.Literal("select"),
  options: Schema.Array(Schema.String),
  default: Schema.optionalKey(Schema.String),
});

export const ScriptInputFieldSchema = Schema.Union([
  ScriptStringInputFieldSchema,
  ScriptNumberInputFieldSchema,
  ScriptBooleanInputFieldSchema,
  ScriptSelectInputFieldSchema,
]);

export type ScriptInputField = typeof ScriptInputFieldSchema.Type;

export const ScriptInputsDefinitionSchema = Schema.Struct({
  id: Schema.String,
  fields: Schema.Array(ScriptInputFieldSchema),
});

export type ScriptInputsDefinition = typeof ScriptInputsDefinitionSchema.Type;

export const ScriptInputValuesSchema = Schema.Record(
  Schema.String,
  ScriptInputValueSchema,
);

export type ScriptInputValues = typeof ScriptInputValuesSchema.Type;

export type ScriptInputValidationResult =
  | { readonly status: "ok"; readonly values: ScriptInputValues }
  | {
      readonly fieldKeys: readonly string[];
      readonly status: "missing-required";
      readonly values: ScriptInputValues;
    };

export const defaultScriptInputValue = (
  field: ScriptInputField,
): ScriptInputValue | undefined =>
  Object.hasOwn(field, "default")
    ? (field as { readonly default: ScriptInputValue }).default
    : undefined;

const normalizeValue = (
  field: ScriptInputField,
  value: unknown,
): ScriptInputValue | undefined => {
  switch (field.type) {
    case "boolean":
      return typeof value === "boolean" ? value : undefined;
    case "number":
      return typeof value === "number" && Number.isFinite(value)
        ? value
        : undefined;
    case "select":
      return typeof value === "string" && field.options.includes(value)
        ? value
        : undefined;
    case "string":
      return typeof value === "string" ? value : undefined;
  }
};

export const normalizeScriptInputValues = (
  definition: ScriptInputsDefinition,
  rawValues: Record<string, unknown> = {},
): ScriptInputValues => {
  const values: Record<string, ScriptInputValue> = {};

  for (const field of definition.fields) {
    const normalized = normalizeValue(field, rawValues[field.key]);
    if (normalized !== undefined) {
      values[field.key] = normalized;
      continue;
    }

    const fallback = defaultScriptInputValue(field);
    if (fallback !== undefined) {
      values[field.key] = fallback;
    }
  }

  return values;
};

export const findMissingRequiredScriptInputs = (
  definition: ScriptInputsDefinition,
  values: ScriptInputValues,
): readonly string[] =>
  definition.fields.flatMap((field) =>
    field.required === true && !Object.hasOwn(values, field.key)
      ? [field.key]
      : [],
  );

export const validateScriptInputValues = (
  definition: ScriptInputsDefinition,
  values: Record<string, unknown>,
): ScriptInputValidationResult => {
  const normalized = normalizeScriptInputValues(definition, values);
  const fieldKeys = findMissingRequiredScriptInputs(definition, normalized);
  return fieldKeys.length === 0
    ? { status: "ok", values: normalized }
    : { fieldKeys, status: "missing-required", values: normalized };
};
