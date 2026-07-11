import type { Duration, Effect, Option, pipe } from "effect";

import type { ArmyApiShape } from "../army/Army";
import type {
  ScriptInputsDefinition,
  ScriptInputValue,
  ScriptInputValues,
} from "@lucent/core/scriptInputs";
import type { AutomationService } from "../automation/Automation";
import type { ApiService } from "../flash/api/Api";
import type { Event, EventSelector } from "../flash/contract/Event";
import type { Packet, PacketSelector } from "../flash/contract/Packet";
import type {
  ScriptExecutionError,
  ScriptStopSignal,
} from "./ScriptRunnerErrors";

export type ScriptEffect<A = unknown, E = unknown> = Effect.Effect<A, E>;

export type ScriptGenerator<A = unknown> = Generator<
  Effect.Effect<any, any, never>,
  A,
  any
>;

export type ScriptCallbackResult<A = unknown> =
  | Effect.Effect<A, unknown>
  | ScriptGenerator<A>;

export interface ScriptEventsApi {
  readonly on: (
    selector: EventSelector | undefined,
    handler: (event: Event) => ScriptCallbackResult,
  ) => Effect.Effect<() => void>;
  readonly once: ApiService["events"]["once"];
  readonly stream: ApiService["events"]["stream"];
}

export interface ScriptPacketApi {
  readonly on: (
    selector: PacketSelector | undefined,
    handler: (packet: Packet) => ScriptCallbackResult,
  ) => Effect.Effect<() => void>;
  readonly once: ApiService["packet"]["once"];
  readonly sendClient: ApiService["packet"]["sendClient"];
  readonly sendServer: ApiService["packet"]["sendServer"];
  readonly stream: ApiService["packet"]["stream"];
}

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

export interface ScriptSettingsApi {
  readonly isAntiCounterEnabled: () => Effect.Effect<boolean>;
  readonly setAnimationsEnabled: (enabled: boolean) => Effect.Effect<void>;
  readonly setAntiCounterEnabled: (enabled: boolean) => Effect.Effect<void>;
  readonly setCollisionsEnabled: (enabled: boolean) => Effect.Effect<void>;
  readonly setCustomGuild: (name: string) => Effect.Effect<void>;
  readonly setCustomName: (name: string) => Effect.Effect<void>;
  readonly setDeathAdsVisible: (visible: boolean) => Effect.Effect<void>;
  readonly setEnemyMagnetEnabled: (enabled: boolean) => Effect.Effect<void>;
  readonly setFrameRate: (fps: number) => Effect.Effect<void>;
  readonly setInfiniteRangeEnabled: (enabled: boolean) => Effect.Effect<void>;
  readonly setLagKillerEnabled: (enabled: boolean) => Effect.Effect<void>;
  readonly setOtherPlayersVisible: (visible: boolean) => Effect.Effect<void>;
  readonly setProvokeCellEnabled: (enabled: boolean) => Effect.Effect<void>;
  readonly setSkipCutscenesEnabled: (enabled: boolean) => Effect.Effect<void>;
  readonly setWalkSpeed: (speed: number) => Effect.Effect<void>;
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
