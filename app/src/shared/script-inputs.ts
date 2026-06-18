export type ScriptInputValue = string | number | boolean;

export type ScriptInputType = "string" | "number" | "boolean" | "select";

export interface ScriptInputField {
  readonly key: string;
  readonly type: ScriptInputType;
  readonly label?: string;
  readonly description?: string;
  readonly required?: boolean;
  readonly defaultValue?: ScriptInputValue;
  readonly options?: readonly string[];
}

export interface ScriptInputsDefinition {
  readonly id: string;
  readonly fields: readonly ScriptInputField[];
}

export type ScriptInputValues = Readonly<Record<string, ScriptInputValue>>;

export interface ScriptInputStorageFile {
  readonly version: 1;
  readonly id: string;
  readonly values: ScriptInputValues;
  readonly updatedAt: string;
}

export interface ScriptInputResolution {
  readonly values: ScriptInputValues;
  readonly missingRequiredKeys: readonly string[];
}

export class ScriptInputsValidationError extends Error {
  override readonly name = "ScriptInputsValidationError";
}

const VALID_TYPES = new Set<ScriptInputType>([
  "string",
  "number",
  "boolean",
  "select",
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const optionalNonEmptyString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;

const requiredNonEmptyString = (value: unknown, path: string): string => {
  const normalized = optionalNonEmptyString(value);
  if (normalized === undefined) {
    throw new ScriptInputsValidationError(`${path} must be a non-empty string`);
  }

  return normalized;
};

const isScriptInputType = (value: unknown): value is ScriptInputType =>
  typeof value === "string" && VALID_TYPES.has(value as ScriptInputType);

export const isScriptInputValue = (value: unknown): value is ScriptInputValue =>
  typeof value === "string" ||
  typeof value === "boolean" ||
  (typeof value === "number" && Number.isFinite(value));

export const normalizeScriptInputValues = (
  value: unknown,
): ScriptInputValues => {
  if (!isRecord(value)) {
    return {};
  }

  const values: Record<string, ScriptInputValue> = {};
  for (const [key, nested] of Object.entries(value)) {
    if (key.trim() === "" || !isScriptInputValue(nested)) {
      continue;
    }

    values[key] = nested;
  }

  return values;
};

const normalizeSelectOptions = (
  value: unknown,
  path: string,
): readonly string[] => {
  if (!Array.isArray(value)) {
    throw new ScriptInputsValidationError(
      `${path}.options must be an array of strings`,
    );
  }

  const options: string[] = [];
  const seen = new Set<string>();
  for (const [index, option] of value.entries()) {
    const normalized = requiredNonEmptyString(
      option,
      `${path}.options[${index}]`,
    );
    if (seen.has(normalized)) {
      throw new ScriptInputsValidationError(
        `${path}.options contains a duplicate value: ${normalized}`,
      );
    }
    seen.add(normalized);
    options.push(normalized);
  }

  if (options.length === 0) {
    throw new ScriptInputsValidationError(
      `${path}.options must include at least one value`,
    );
  }

  return options;
};

export const normalizeScriptInputValueForField = (
  field: ScriptInputField,
  value: unknown,
): ScriptInputValue | undefined => {
  if (value === undefined) {
    return undefined;
  }

  if (field.type === "string") {
    return typeof value === "string" && value !== "" ? value : undefined;
  }

  if (field.type === "number") {
    return typeof value === "number" && Number.isFinite(value)
      ? value
      : undefined;
  }

  if (field.type === "boolean") {
    return typeof value === "boolean" ? value : undefined;
  }

  if (field.type === "select") {
    return typeof value === "string" && field.options?.includes(value)
      ? value
      : undefined;
  }

  return undefined;
};

const normalizeDefaultValue = (
  field: ScriptInputField,
  value: unknown,
  path: string,
): ScriptInputValue | undefined => {
  if (value === undefined) {
    return undefined;
  }

  const normalized = normalizeScriptInputValueForField(field, value);
  if (normalized === undefined) {
    throw new ScriptInputsValidationError(
      `${path}.defaultValue must match ${field.type}`,
    );
  }

  return normalized;
};

const normalizeField = (value: unknown, index: number): ScriptInputField => {
  const path = `inputs.fields[${index}]`;
  if (!isRecord(value)) {
    throw new ScriptInputsValidationError(`${path} must be an object`);
  }

  const key = requiredNonEmptyString(value["key"], `${path}.key`);
  const type = value["type"];
  if (!isScriptInputType(type)) {
    throw new ScriptInputsValidationError(
      `${path}.type must be one of: string, number, boolean, select`,
    );
  }

  const label = optionalNonEmptyString(value["label"]);
  const description = optionalNonEmptyString(value["description"]);
  const base: ScriptInputField = {
    key,
    type,
    ...(label === undefined ? {} : { label }),
    ...(description === undefined ? {} : { description }),
    ...(value["required"] === true ? { required: true } : {}),
  };

  const withOptions: ScriptInputField =
    type === "select"
      ? {
          ...base,
          options: normalizeSelectOptions(value["options"], path),
        }
      : base;

  const defaultValue = normalizeDefaultValue(
    withOptions,
    value["defaultValue"],
    path,
  );
  return defaultValue === undefined
    ? withOptions
    : { ...withOptions, defaultValue };
};

export const normalizeScriptInputsDefinition = (
  value: unknown,
): ScriptInputsDefinition => {
  if (!isRecord(value)) {
    throw new ScriptInputsValidationError("inputs must be an object");
  }

  const id = requiredNonEmptyString(value["id"], "inputs.id");
  const fields = value["fields"];
  if (!Array.isArray(fields)) {
    throw new ScriptInputsValidationError("inputs.fields must be an array");
  }

  const seenKeys = new Set<string>();
  const normalizedFields = fields.map((field, index) => {
    const normalized = normalizeField(field, index);
    if (seenKeys.has(normalized.key)) {
      throw new ScriptInputsValidationError(
        `inputs.fields contains a duplicate key: ${normalized.key}`,
      );
    }

    seenKeys.add(normalized.key);
    return normalized;
  });

  return { id, fields: normalizedFields };
};

export const resolveScriptInputValues = (
  definition: ScriptInputsDefinition,
  savedValues: ScriptInputValues,
): ScriptInputResolution => {
  const values: Record<string, ScriptInputValue> = {};
  const missingRequiredKeys: string[] = [];

  for (const field of definition.fields) {
    const hasSavedValue = Object.prototype.hasOwnProperty.call(
      savedValues,
      field.key,
    );
    const savedValue = hasSavedValue
      ? normalizeScriptInputValueForField(field, savedValues[field.key])
      : undefined;
    const value =
      savedValue ??
      normalizeScriptInputValueForField(field, field.defaultValue);
    if (value !== undefined) {
      values[field.key] = value;
      continue;
    }

    if (field.required) {
      missingRequiredKeys.push(field.key);
    }
  }

  return { values, missingRequiredKeys };
};

export const mergeDeclaredScriptInputValues = (
  definition: ScriptInputsDefinition,
  currentValues: ScriptInputValues,
  nextDeclaredValues: ScriptInputValues,
): ScriptInputValues => {
  const declaredKeys = new Set(definition.fields.map((field) => field.key));
  const merged: Record<string, ScriptInputValue> = {};

  for (const [key, value] of Object.entries(currentValues)) {
    if (!declaredKeys.has(key)) {
      merged[key] = value;
    }
  }

  for (const field of definition.fields) {
    const value = normalizeScriptInputValueForField(
      field,
      nextDeclaredValues[field.key],
    );
    if (value !== undefined) {
      merged[field.key] = value;
    }
  }

  return merged;
};
