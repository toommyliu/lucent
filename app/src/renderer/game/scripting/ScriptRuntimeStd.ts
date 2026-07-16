import { Cause, Effect } from "effect";

import type { AutomationService } from "../automation/Automation";
import type { BridgeService } from "../flash/bridge/Bridge";
import { makeScriptEventsApi } from "./api/Events";
import { makeScriptPacketApi } from "./api/Packet";
import { makeScriptPlayerApis } from "./api/Player";
import { makeScriptRecipesApi } from "./api/Recipes";
import type { ScriptRuntimeServices } from "./api/Services";
import { makeScriptSettingsApi } from "./api/Settings";
import type { ScriptLucentStd, ScriptRuntimeApi } from "./ScriptApi";
import type { ScriptAsyncScope } from "./scriptAsyncScope";

export interface ScriptRuntimeFeatures {
  readonly autoRelogin: AutomationService["autoRelogin"];
  readonly autoZone: AutomationService["autoZone"];
}

export interface ScriptRuntimeStdOptions {
  readonly bridge: BridgeService;
  readonly failCause: (cause: Cause.Cause<unknown>) => Effect.Effect<void>;
  readonly features: ScriptRuntimeFeatures;
  readonly scope: ScriptAsyncScope;
  readonly script: ScriptRuntimeApi;
  readonly services: ScriptRuntimeServices;
}

export const makeScriptLucentStd = (
  options: ScriptRuntimeStdOptions,
): ScriptLucentStd => {
  const events = makeScriptEventsApi(
    options.services.events,
    options.scope,
    options.failCause,
  );
  const packet = makeScriptPacketApi(
    options.services.packet,
    options.scope,
    options.failCause,
  );
  const { player, players } = makeScriptPlayerApis(
    options.services.player,
    options.services.players,
    options.script,
  );
  const settings = makeScriptSettingsApi(options.services.settings);
  const recipes = makeScriptRecipesApi(
    { ...options.services, player },
    options.bridge,
  );
  const services = { ...options.services, player, players };

  return Object.freeze({
    api: Object.freeze({
      ...services,
      events,
      packet,
      recipes,
      settings,
    }),
    features: Object.freeze({
      antiCounter: Object.freeze({
        isEnabled: options.services.settings.isAntiCounterEnabled,
        setEnabled: options.services.settings.setAntiCounterEnabled,
      }),
      autoRelogin: options.features.autoRelogin,
      autoZone: options.features.autoZone,
    }),
    script: options.script,
  });
};
