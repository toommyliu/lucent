import type { ScriptExecutePayload } from "../../../shared/ipc";
import type { ScriptInputsDefinition } from "../../../shared/script-inputs";

export interface ManualScriptLoad {
  readonly source: string;
  readonly name: string;
  readonly path?: string;
  readonly inputs?: ScriptInputsDefinition;
}

export interface PendingManualScriptLoad {
  readonly currentScriptName: string;
  readonly nextScript: ManualScriptLoad;
}

export interface ManualScriptLoadRequestActions {
  readonly scriptRunning: () => boolean;
  readonly currentScriptName: () => string;
  readonly applyLoadedScript: (script: ManualScriptLoad) => void;
  readonly setPendingManualScriptLoad: (
    pending: PendingManualScriptLoad,
  ) => void;
}

export type ManualScriptLoadRequestResult =
  | {
      readonly status: "loaded";
      readonly script: ManualScriptLoad;
    }
  | {
      readonly status: "pending";
      readonly pending: PendingManualScriptLoad;
    };

export interface ConfirmPendingManualScriptLoadActions {
  readonly stopRunningScript: () => Promise<void>;
  readonly applyLoadedScript: (script: ManualScriptLoad) => void;
}

export const scriptExecutePayloadName = (
  payload: Pick<ScriptExecutePayload, "name" | "path">,
): string => payload.name ?? payload.path ?? "script";

export const toManualScriptLoad = (
  payload: ScriptExecutePayload,
): ManualScriptLoad => ({
  source: payload.source,
  name: scriptExecutePayloadName(payload),
  ...(payload.path === undefined ? {} : { path: payload.path }),
  ...(payload.inputs === undefined ? {} : { inputs: payload.inputs }),
});

const normalizeCurrentScriptName = (name: string): string => {
  const trimmed = name.trim();
  return trimmed === "" ? "script" : trimmed;
};

export const createPendingManualScriptLoad = (
  payload: ScriptExecutePayload,
  currentScriptName: string,
): PendingManualScriptLoad => ({
  currentScriptName: normalizeCurrentScriptName(currentScriptName),
  nextScript: toManualScriptLoad(payload),
});

export const requestManualScriptLoad = (
  payload: ScriptExecutePayload,
  actions: ManualScriptLoadRequestActions,
): ManualScriptLoadRequestResult => {
  const script = toManualScriptLoad(payload);

  if (!actions.scriptRunning()) {
    actions.applyLoadedScript(script);
    return { status: "loaded", script };
  }

  const pending: PendingManualScriptLoad = {
    currentScriptName: normalizeCurrentScriptName(actions.currentScriptName()),
    nextScript: script,
  };
  actions.setPendingManualScriptLoad(pending);
  return { status: "pending", pending };
};

export const confirmPendingManualScriptLoad = async (
  pending: PendingManualScriptLoad,
  actions: ConfirmPendingManualScriptLoadActions,
): Promise<ManualScriptLoad> => {
  await actions.stopRunningScript();
  actions.applyLoadedScript(pending.nextScript);
  return pending.nextScript;
};
