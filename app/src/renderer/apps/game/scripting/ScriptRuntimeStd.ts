import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";

import type { RoomPolicy } from "@lucent/core/accountSettings";
import type { BridgeService } from "../flash/bridge/Bridge";
import { makeScriptArmyApi } from "./api/Army";
import { makeScriptEventsApi } from "./api/Events";
import { makeScriptEnvironmentApi } from "./api/Environment";
import { makeScriptPacketApi } from "./api/Packet";
import { makeScriptPlayerApis } from "./api/Player";
import { makeScriptRecipesApi } from "./api/Recipes";
import type { ScriptRuntimeServices } from "./api/Services";
import { makeScriptSettingsApi } from "./api/Settings";
import type {
  ScriptAutoReloginFeature,
  ScriptAutoZoneFeature,
  ScriptLucentStd,
  ScriptRuntimeApi,
} from "./ScriptApi";
import type { ScriptAsyncScope } from "./scriptAsyncScope";

export interface ScriptRuntimeFeatures {
  readonly autoRelogin: ScriptAutoReloginFeature;
  readonly autoZone: ScriptAutoZoneFeature;
}

export interface ScriptRuntimeStdOptions {
  readonly bridge: BridgeService;
  readonly failCause: (cause: Cause.Cause<unknown>) => Effect.Effect<void>;
  readonly features: ScriptRuntimeFeatures;
  readonly roomPolicy: Effect.Effect<RoomPolicy>;
  readonly scope: ScriptAsyncScope;
  readonly script: ScriptRuntimeApi;
  readonly services: ScriptRuntimeServices;
}

export const makeScriptLucentStd = (
  options: ScriptRuntimeStdOptions,
): ScriptLucentStd => {
  const army = makeScriptArmyApi(
    options.services.army,
    options.scope,
    options.failCause,
  );
  const events = makeScriptEventsApi(
    options.services.events,
    options.scope,
    options.failCause,
  );
  const environment = makeScriptEnvironmentApi(options.services.environment);
  const packet = makeScriptPacketApi(
    options.services.packet,
    options.scope,
    options.failCause,
  );
  const { player, players } = makeScriptPlayerApis(
    options.services.player,
    options.services.players,
    { policy: options.roomPolicy },
  );
  const settings = makeScriptSettingsApi(options.services.settings);
  const recipes = makeScriptRecipesApi(
    { ...options.services, player },
    options.bridge,
  );
  const services = { ...options.services, army, player, players };

  return Object.freeze({
    api: Object.freeze({
      ...services,
      environment,
      events,
      packet,
      recipes,
      settings,
    }),
    features: Object.freeze({
      autoRelogin: options.features.autoRelogin,
      autoZone: options.features.autoZone,
    }),
    script: options.script,
  });
};
