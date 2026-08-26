import {
  normalizeScriptInputValues,
  validateScriptInputValues,
  type ScriptInputField,
  type ScriptInputValue,
  type ScriptInputValues,
  type ScriptInputsDefinition,
} from "@lucent/core/scriptInputs";

import type {
  ScriptInputsDialogError,
  ScriptInputsDialogErrorField,
} from "./ScriptInputsErrorAlert";

export type ScriptInputDraftValue = boolean | string | readonly string[];
export type ScriptInputDraftValues = Readonly<
  Record<string, ScriptInputDraftValue>
>;

export const scriptInputFieldLabel = (field: ScriptInputField): string =>
  field.label || field.key;

const scriptInputFieldError = (
  field: ScriptInputField,
  message: string,
): ScriptInputsDialogErrorField => ({
  key: field.key,
  label: scriptInputFieldLabel(field),
  message,
});

const scriptInputFieldByKey = (
  definition: ScriptInputsDefinition,
  key: string,
): ScriptInputField | undefined =>
  definition.fields.find((field) => field.key === key);

const isStringArray = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

export const scriptInputDraftFromValues = (
  definition: ScriptInputsDefinition,
  values: ScriptInputValues,
): ScriptInputDraftValues => {
  const normalized = normalizeScriptInputValues(definition, values);
  const draft: Record<string, ScriptInputDraftValue> = {};

  for (const field of definition.fields) {
    const value = normalized[field.key];
    if (field.type === "boolean") {
      draft[field.key] = value === true;
    } else if (field.type === "multi-select") {
      draft[field.key] = isStringArray(value) ? [...value] : [];
    } else {
      draft[field.key] = String(value ?? "");
    }
  }

  return draft;
};

export const scriptInputValuesFromDraft = (
  definition: ScriptInputsDefinition,
  draft: ScriptInputDraftValues,
):
  | { readonly ok: true; readonly values: ScriptInputValues }
  | { readonly error: ScriptInputsDialogError; readonly ok: false } => {
  const values: Record<string, ScriptInputValue> = {};
  const invalidFields: ScriptInputsDialogErrorField[] = [];

  for (const field of definition.fields) {
    const draftValue = draft[field.key];
    if (field.type === "boolean") {
      values[field.key] = draftValue === true;
      continue;
    }

    if (field.type === "multi-select") {
      if (
        !isStringArray(draftValue) ||
        draftValue.some((value) => !field.options.includes(value))
      ) {
        invalidFields.push(
          scriptInputFieldError(field, "Select only declared options"),
        );
        continue;
      }
      values[field.key] = draftValue;
      continue;
    }

    const text = typeof draftValue === "string" ? draftValue.trim() : "";
    if (text === "") {
      continue;
    }

    if (field.type === "number") {
      const value = Number(text);
      if (!Number.isFinite(value)) {
        invalidFields.push(scriptInputFieldError(field, "Enter a number"));
        continue;
      }
      values[field.key] = value;
      continue;
    }

    if (field.type === "select" && !field.options.includes(text)) {
      invalidFields.push(
        scriptInputFieldError(field, "Select a declared option"),
      );
      continue;
    }

    values[field.key] = text;
  }

  const validation = validateScriptInputValues(definition, values);
  const invalidKeys = new Set(invalidFields.map((field) => field.key));
  const missingFields =
    validation.status === "missing-required"
      ? validation.fieldKeys
          .filter((key) => !invalidKeys.has(key))
          .map((key) => scriptInputFieldByKey(definition, key))
          .filter((field): field is ScriptInputField => field !== undefined)
          .map((field) =>
            scriptInputFieldError(
              field,
              field.type === "multi-select"
                ? "Select at least one option"
                : "Required",
            ),
          )
      : [];
  const fields = [...invalidFields, ...missingFields];

  if (fields.length > 0) {
    const message =
      invalidFields.length > 0 && missingFields.length > 0
        ? "Correct the invalid script inputs."
        : invalidFields.length > 0
          ? "Some script inputs are invalid."
          : "Fill in all required script inputs.";
    return {
      error: { fields, message },
      ok: false,
    };
  }

  return { ok: true, values: validation.values };
};

export const scriptSelectFieldOptions = (
  field: ScriptInputField,
): readonly string[] =>
  field.type === "select" || field.type === "multi-select" ? field.options : [];
