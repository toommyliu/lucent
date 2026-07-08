import type { Duration, Effect, Option } from "effect";

import type { ArmyApiShape } from "../army/Army";
import type {
  ScriptInputsDefinition,
  ScriptInputValue,
  ScriptInputValues,
} from "@lucent/core/scriptInputs";
import type { AuthApiShape } from "../flash/api/Auth";
import type { BankApiShape } from "../flash/api/Bank";
import type { CombatApiShape } from "../flash/api/Combat";
import type { DropsApiShape } from "../flash/api/Drops";
import type { EventsApiShape } from "../flash/api/Events";
import type { HouseApiShape } from "../flash/api/House";
import type { InventoryApiShape } from "../flash/api/Inventory";
import type { MapApiShape } from "../flash/api/Map";
import type { MonstersApiShape } from "../flash/api/Monsters";
import type { PacketApiShape } from "../flash/api/Packet";
import type { PlayerApiShape } from "../flash/api/Player";
import type { PlayersApiShape } from "../flash/api/Players";
import type { QuestsApiShape } from "../flash/api/Quests";
import type { ShopsApiShape } from "../flash/api/Shops";
import type { TempInventoryApiShape } from "../flash/api/TempInventory";
import type { WaitApiShape } from "../flash/api/Wait";
import type { AutoReloginShape } from "../flash/features/AutoRelogin";
import type { AutoZoneShape } from "../flash/features/AutoZone";
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

export type ScriptInputType = "string" | "number" | "boolean" | "select";

export type { ScriptInputsDefinition, ScriptInputValue, ScriptInputValues };

export interface ScriptAntiCounterFeature {
  readonly isEnabled: () => Effect.Effect<boolean>;
  readonly setEnabled: (enabled: boolean) => Effect.Effect<void>;
}

export interface ScriptFeaturesApi {
  readonly antiCounter: ScriptAntiCounterFeature;
  readonly autoRelogin: AutoReloginShape;
  readonly autoZone: AutoZoneShape;
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
  readonly auth: AuthApiShape;
  readonly bank: BankApiShape;
  readonly combat: CombatApiShape;
  readonly drops: DropsApiShape;
  readonly events: EventsApiShape;
  readonly house: HouseApiShape;
  readonly inventory: InventoryApiShape;
  readonly map: MapApiShape;
  readonly monsters: MonstersApiShape;
  readonly packet: PacketApiShape;
  readonly player: PlayerApiShape;
  readonly players: PlayersApiShape;
  readonly quests: QuestsApiShape;
  readonly settings: ScriptSettingsApi;
  readonly shops: ShopsApiShape;
  readonly tempInventory: TempInventoryApiShape;
  readonly wait: WaitApiShape;
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
  readonly pipe: typeof import("effect").pipe;
}

export type ScriptMain = () => ScriptGenerator<unknown>;

export interface ScriptModuleExports extends ScriptMain {
  readonly inputs?: ScriptInputsDefinition;
}
