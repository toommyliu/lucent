import { ServiceMap } from "effect";
import type { Effect } from "effect";
import type { BridgeError } from "../../flash/Services/Bridge";
import type {
  ScriptExecutionError,
  ScriptLoadError,
  ScriptNotReadyError,
} from "../Errors";
import type { ScriptDiagnostic } from "../Types";
import type { ScriptInputValues, ScriptOptions } from "../ipc";
import type { ScriptRunnerStatus } from "../scriptRunnerStatus";

export interface RunScriptOptions {
  readonly name?: string;
  readonly options?: Partial<ScriptOptions>;
  readonly inputs?: ScriptInputValues;
}

export type ScriptRunnerError =
  | BridgeError
  | ScriptExecutionError
  | ScriptLoadError
  | ScriptNotReadyError;

export interface ScriptRunnerShape {
  run(
    source: string,
    options?: RunScriptOptions,
  ): Effect.Effect<void, ScriptRunnerError>;
  stop(reason?: string): Effect.Effect<void>;
  getStatus(): Effect.Effect<ScriptRunnerStatus>;
  onStatus(
    listener: (status: ScriptRunnerStatus) => void,
    options?: { readonly emitCurrent?: boolean },
  ): Effect.Effect<() => void>;
  isRunning(): Effect.Effect<boolean>;
  diagnostics(): Effect.Effect<ReadonlyArray<ScriptDiagnostic>>;
  getOptions(): Effect.Effect<Readonly<ScriptOptions>>;
  setUsePrivateRooms(enabled: boolean): Effect.Effect<void>;
  setSafeStartStop(enabled: boolean): Effect.Effect<void>;
}

export class ScriptRunner extends ServiceMap.Service<
  ScriptRunner,
  ScriptRunnerShape
>()("scripting/Services/ScriptRunner") {}
