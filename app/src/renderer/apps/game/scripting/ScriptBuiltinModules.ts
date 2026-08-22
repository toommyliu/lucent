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
import { makeScriptShopsApi } from "./api/Shops";
import type {
  ScriptApi,
  ScriptAutoReloginApi,
  ScriptAutoZoneApi,
  ScriptEffectStd,
  ScriptRuntimeApi,
} from "./ScriptApi";
import type { ScriptAsyncScope } from "./scriptAsyncScope";
import { scriptEffectStd } from "./ScriptEffectStd";

export interface ScriptBuiltinModules {
  readonly effect: ScriptEffectStd;
  readonly "lucent/api": ScriptApi;
  readonly "lucent/autorelogin": ScriptAutoReloginApi;
  readonly "lucent/autozone": ScriptAutoZoneApi;
  readonly "lucent/script": ScriptRuntimeApi;
}

export interface ScriptBuiltinModulesOptions {
  readonly autoRelogin: ScriptAutoReloginApi;
  readonly autoZone: ScriptAutoZoneApi;
  readonly bridge: BridgeService;
  readonly failCause: (cause: Cause.Cause<unknown>) => Effect.Effect<void>;
  readonly roomPolicy: Effect.Effect<RoomPolicy>;
  readonly scope: ScriptAsyncScope;
  readonly script: ScriptRuntimeApi;
  readonly services: ScriptRuntimeServices;
}

const makeScriptAutoReloginApi = (
  api: ScriptAutoReloginApi,
): ScriptAutoReloginApi =>
  Object.freeze({
    disable: api.disable,
    enable: api.enable,
    getDelay: api.getDelay,
    getServer: api.getServer,
    getState: api.getState,
    isEnabled: api.isEnabled,
    runLogin: api.runLogin,
    setDelay: api.setDelay,
    setEnabled: api.setEnabled,
    setServer: api.setServer,
  });

const makeScriptAutoZoneApi = (api: ScriptAutoZoneApi): ScriptAutoZoneApi =>
  Object.freeze({
    getMap: api.getMap,
    getState: api.getState,
    isEnabled: api.isEnabled,
    setEnabled: api.setEnabled,
    setMap: api.setMap,
  });

/** Creates the frozen built-in module registry for one script execution. */
export const makeScriptBuiltinModules = (
  options: ScriptBuiltinModulesOptions,
): ScriptBuiltinModules => {
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
  const scriptServices = { ...options.services, player };
  const recipes = makeScriptRecipesApi(scriptServices);
  const shops = makeScriptShopsApi(scriptServices, options.bridge);
  const services = { ...scriptServices, army, players, shops };

  return Object.freeze({
    effect: scriptEffectStd,
    "lucent/api": Object.freeze({
      ...services,
      environment,
      events,
      packet,
      recipes,
      settings,
    }),
    "lucent/autorelogin": makeScriptAutoReloginApi(options.autoRelogin),
    "lucent/autozone": makeScriptAutoZoneApi(options.autoZone),
    "lucent/script": options.script,
  });
};
