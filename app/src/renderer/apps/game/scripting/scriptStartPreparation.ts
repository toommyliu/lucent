import type { ScriptFile } from "../../../../shared/ipc/scripting";
import {
  validateScriptInputValues,
  type ScriptInputValues,
  type ScriptInputsDefinition,
} from "@lucent/core/scriptInputs";

export interface CurrentScriptStart {
  readonly file: ScriptFile;
  readonly inputValues: ScriptInputValues;
}

export type ScriptStartPreparation =
  | {
      readonly file: ScriptFile;
      readonly inputValues: ScriptInputValues;
      readonly status: "ready";
    }
  | {
      readonly file: ScriptFile;
      readonly inputValues: ScriptInputValues;
      readonly status: "missing-required";
    };

export interface ScriptStartPreparationDependencies {
  readonly getInputValues: (
    definition: ScriptInputsDefinition,
  ) => Promise<ScriptInputValues>;
  readonly readFile: (path: string) => Promise<ScriptFile>;
}

export const prepareScriptStart = async (
  current: CurrentScriptStart,
  reloadBeforeStart: boolean,
  dependencies: ScriptStartPreparationDependencies,
): Promise<ScriptStartPreparation> => {
  const file = reloadBeforeStart
    ? await dependencies.readFile(current.file.path)
    : current.file;
  const inputValues =
    !reloadBeforeStart || file.revision === current.file.revision
      ? current.inputValues
      : file.inputs === null
        ? {}
        : await dependencies.getInputValues(file.inputs);

  if (file.inputs === null) {
    return { file, inputValues: {}, status: "ready" };
  }

  const validation = validateScriptInputValues(file.inputs, inputValues);
  return {
    file,
    inputValues: validation.values,
    status:
      validation.status === "missing-required" ? "missing-required" : "ready",
  };
};
