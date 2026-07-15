import type { Duration, Effect, Option, pipe } from "effect";

import type { ArmyApiShape } from "../army/Army";
import type {
  ScriptInputsDefinition,
  ScriptInputValue,
  ScriptInputValues,
} from "@lucent/core/scriptInputs";
import type { AutomationService } from "../automation/Automation";
import type { ApiService } from "../flash/api/Api";
import type { ScriptCallbackResult, ScriptGenerator } from "./api/Callbacks";
import type { ScriptEventsApi } from "./api/Events";
import type { ScriptPacketApi } from "./api/Packet";
import type { ScriptRecipesApi } from "./api/Recipes";
import type { ScriptSettingsApi } from "./api/Settings";
import type {
  ScriptExecutionError,
  ScriptStopSignal,
} from "./ScriptRunnerErrors";

export type ScriptEffect<A = unknown, E = unknown> = Effect.Effect<A, E>;

export type { ScriptCallbackResult, ScriptGenerator };
export type { ScriptEnhanceItemOptions, ScriptRecipesApi } from "./api/Recipes";

export type ScriptInputType = "string" | "number" | "boolean" | "select";

export type { ScriptInputsDefinition, ScriptInputValue, ScriptInputValues };

export interface ScriptAntiCounterFeature {
  readonly isEnabled: () => Effect.Effect<boolean>;
  readonly setEnabled: (enabled: boolean) => Effect.Effect<void>;
}

export interface ScriptFeaturesApi {
  readonly antiCounter: ScriptAntiCounterFeature;
  readonly autoRelogin: AutomationService["autoRelogin"];
  readonly autoZone: AutomationService["autoZone"];
}

export interface ScriptApi {
  readonly army: ArmyApiShape;
  readonly auth: ApiService["auth"];
  readonly bank: ApiService["bank"];
  readonly combat: ApiService["combat"];
  readonly drops: ApiService["drops"];
  readonly events: ScriptEventsApi;
  readonly house: ApiService["house"];
  readonly inventory: ApiService["inventory"];
  readonly map: ApiService["map"];
  readonly monsters: ApiService["monsters"];
  readonly packet: ScriptPacketApi;
  readonly player: ApiService["player"];
  readonly players: ApiService["players"];
  readonly quests: ApiService["quests"];
  readonly recipes: ScriptRecipesApi;
  readonly settings: ScriptSettingsApi;
  readonly shops: ApiService["shops"];
  readonly tempInventory: ApiService["tempInventory"];
  readonly wait: ApiService["wait"];
}

export interface ScriptInputsApi {
  readonly get: (key: string) => Effect.Effect<ScriptInputValue | undefined>;
  readonly getAll: () => Effect.Effect<ScriptInputValues>;
}

export interface ScriptRuntimeOptions {
  readonly safeStartStop: boolean;
  readonly usePrivateRooms: boolean;
}

export interface ScriptOptionsApi {
  readonly getAll: () => Effect.Effect<ScriptRuntimeOptions>;
  readonly getSafeStartStop: () => Effect.Effect<boolean>;
  readonly getUsePrivateRooms: () => Effect.Effect<boolean>;
  readonly reset: () => Effect.Effect<ScriptRuntimeOptions>;
  readonly setSafeStartStop: (
    enabled: boolean,
  ) => Effect.Effect<ScriptRuntimeOptions>;
  readonly setUsePrivateRooms: (
    enabled: boolean,
  ) => Effect.Effect<ScriptRuntimeOptions>;
}

export interface ScriptRuntimeApi {
  readonly signal: AbortSignal;
  readonly inputs: ScriptInputsApi;
  readonly options: ScriptOptionsApi;
  readonly exit: (options?: {
    readonly closeWindow?: boolean;
    readonly logout?: boolean;
  }) => Effect.Effect<never, ScriptStopSignal>;
  readonly log: (message: unknown) => Effect.Effect<void>;
  readonly sleep: (ms: number) => Effect.Effect<void, ScriptExecutionError>;
  readonly stop: (reason?: string) => Effect.Effect<never, ScriptStopSignal>;
}

export interface ScriptLucentStd {
  readonly api: ScriptApi;
  readonly features: ScriptFeaturesApi;
  readonly script: ScriptRuntimeApi;
}

export interface ScriptContext {
  readonly api: ScriptApi;
  readonly features: ScriptFeaturesApi;
  readonly script: ScriptRuntimeApi;
}

export interface ScriptEffectStd {
  readonly Duration: typeof Duration;
  readonly Effect: typeof Effect;
  readonly Option: typeof Option;
  readonly pipe: typeof pipe;
}

export type ScriptMain = () => ScriptGenerator<unknown>;

export interface ScriptModuleExports extends ScriptMain {
  readonly inputs?: ScriptInputsDefinition;
}
