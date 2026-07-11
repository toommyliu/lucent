import { Cause, Effect } from "effect";

import type { ArmyApiShape } from "../army/Army";
import type { AutomationService } from "../automation/Automation";
import type { ApiService } from "../flash/api/Api";
import type { Event as FlashEvent } from "../flash/contract/Event";
import type { Packet as FlashPacket } from "../flash/contract/Packet";
import { privateRoom, randomPrivateRoom } from "../flash/domain/MapTarget";
import type {
  ScriptCallbackResult,
  ScriptEventsApi,
  ScriptPacketApi,
  ScriptLucentStd,
  ScriptRuntimeApi,
  ScriptSettingsApi,
} from "./ScriptApi";
import type { ScriptAsyncScope } from "./scriptAsyncScope";
import { ScriptExecutionError } from "./ScriptRunnerErrors";

export interface ScriptRuntimeServices {
  readonly army: ArmyApiShape;
  readonly auth: ApiService["auth"];
  readonly bank: ApiService["bank"];
  readonly combat: ApiService["combat"];
  readonly drops: ApiService["drops"];
  readonly events: ApiService["events"];
  readonly house: ApiService["house"];
  readonly inventory: ApiService["inventory"];
  readonly map: ApiService["map"];
  readonly monsters: ApiService["monsters"];
  readonly packet: ApiService["packet"];
  readonly player: ApiService["player"];
  readonly players: ApiService["players"];
  readonly quests: ApiService["quests"];
  readonly settings: ApiService["settings"];
  readonly shops: ApiService["shops"];
  readonly tempInventory: ApiService["tempInventory"];
  readonly wait: ApiService["wait"];
}

export interface ScriptRuntimeFeatures {
  readonly autoRelogin: AutomationService["autoRelogin"];
  readonly autoZone: AutomationService["autoZone"];
}

export interface ScriptRuntimeStdOptions {
  readonly failCause: (cause: Cause.Cause<unknown>) => Effect.Effect<void>;
  readonly features: ScriptRuntimeFeatures;
  readonly scope: ScriptAsyncScope;
  readonly script: ScriptRuntimeApi;
  readonly services: ScriptRuntimeServices;
}

type ScriptPrivateRoomContext = {
  readonly options: Pick<ScriptRuntimeApi["options"], "getUsePrivateRooms">;
};

const applyPrivateRoom = (
  map: string,
  script: ScriptPrivateRoomContext,
): Effect.Effect<string> =>
  Effect.gen(function* () {
    const trimmed = map.trim();
    if (trimmed === "" || !(yield* script.options.getUsePrivateRooms())) {
      return map;
    }

    const room = yield* randomPrivateRoom;
    return privateRoom(trimmed, room);
  });

const isGenerator = (value: unknown): value is Generator =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { readonly next?: unknown }).next === "function" &&
  typeof (value as { readonly throw?: unknown }).throw === "function";

export const normalizeScriptCallbackResult = (
  result: unknown,
): Effect.Effect<unknown, unknown> => {
  if (Effect.isEffect(result)) {
    return result as Effect.Effect<unknown, unknown>;
  }

  if (isGenerator(result)) {
    return Effect.gen(function* () {
      const iterator = result as Generator<
        Effect.Effect<any, any, never>,
        unknown,
        any
      >;
      return yield* iterator;
    });
  }

  return Effect.fail(
    new ScriptExecutionError({
      detail:
        "Script callbacks must return an Effect or generator; plain values and Promises are not supported.",
    }),
  );
};

export const normalizeScriptCallback = <A>(
  callback: (value: A) => ScriptCallbackResult | unknown,
  value: A,
): Effect.Effect<void, unknown> =>
  Effect.try({
    try: () => callback(value),
    catch: (cause) =>
      new ScriptExecutionError({
        detail: "Script callback threw before returning an Effect.",
        cause,
      }),
  }).pipe(Effect.flatMap(normalizeScriptCallbackResult), Effect.asVoid);

const notifyCallbackFailure =
  <A>(
    callback: (value: A) => ScriptCallbackResult | unknown,
    failCause: (cause: Cause.Cause<unknown>) => Effect.Effect<void>,
  ): ((value: A) => Effect.Effect<void, unknown>) =>
  (value) =>
    normalizeScriptCallback(callback, value).pipe(
      Effect.catchCause((cause) =>
        failCause(cause).pipe(Effect.andThen(Effect.failCause(cause))),
      ),
    );

const wrapEvents = (
  events: ApiService["events"],
  scope: ScriptAsyncScope,
  failCause: (cause: Cause.Cause<unknown>) => Effect.Effect<void>,
): ScriptEventsApi => ({
  ...events,
  on: (selector, handler) =>
    events
      .on(selector, notifyCallbackFailure<FlashEvent>(handler, failCause))
      .pipe(Effect.tap((dispose) => scope.addCleanup(dispose))),
});

const wrapPacket = (
  packet: ApiService["packet"],
  scope: ScriptAsyncScope,
  failCause: (cause: Cause.Cause<unknown>) => Effect.Effect<void>,
): ScriptPacketApi => ({
  ...packet,
  on: (selector, handler) =>
    packet
      .on(selector, notifyCallbackFailure<FlashPacket>(handler, failCause))
      .pipe(Effect.tap((dispose) => scope.addCleanup(dispose))),
});

const makeScriptPlayerJoinMap =
  (
    joinMap: ApiService["player"]["joinMap"],
    script: ScriptPrivateRoomContext,
  ): ApiService["player"]["joinMap"] =>
  (map, cell, pad) =>
    applyPrivateRoom(map, script).pipe(
      Effect.flatMap((targetMap) => joinMap(targetMap, cell, pad)),
    );

export const makeScriptPlayerFacades = <
  PlayerSource extends Pick<ApiService["player"], "get" | "joinMap">,
  PlayersSource extends Pick<ApiService["players"], "getMe">,
>(
  player: PlayerSource,
  players: PlayersSource,
  script: ScriptPrivateRoomContext,
) => {
  const playerFacade = {
    ...player,
    joinMap: makeScriptPlayerJoinMap(
      (map, cell, pad) => player.joinMap(map, cell, pad),
      script,
    ),
  };

  return {
    player: playerFacade,
    players: {
      ...players,
      getMe: playerFacade.get,
    },
  };
};

const makeSettingsFacade = (
  settings: ApiService["settings"],
): ScriptSettingsApi =>
  Object.freeze({
    isAntiCounterEnabled: settings.isAntiCounterEnabled,
    setAnimationsEnabled: settings.setAnimationsEnabled,
    setAntiCounterEnabled: settings.setAntiCounterEnabled,
    setCollisionsEnabled: settings.setCollisionsEnabled,
    setCustomGuild: settings.setCustomGuild,
    setCustomName: settings.setCustomName,
    setDeathAdsVisible: settings.setDeathAdsVisible,
    setEnemyMagnetEnabled: settings.setEnemyMagnetEnabled,
    setFrameRate: settings.setFrameRate,
    setInfiniteRangeEnabled: settings.setInfiniteRangeEnabled,
    setLagKillerEnabled: settings.setLagKillerEnabled,
    setOtherPlayersVisible: settings.setOtherPlayersVisible,
    setProvokeCellEnabled: settings.setProvokeCellEnabled,
    setSkipCutscenesEnabled: settings.setSkipCutscenesEnabled,
    setWalkSpeed: settings.setWalkSpeed,
  });

export const makeScriptLucentStd = (
  options: ScriptRuntimeStdOptions,
): ScriptLucentStd => {
  const events = wrapEvents(
    options.services.events,
    options.scope,
    options.failCause,
  );
  const packet = wrapPacket(
    options.services.packet,
    options.scope,
    options.failCause,
  );
  const { player, players } = makeScriptPlayerFacades(
    options.services.player,
    options.services.players,
    options.script,
  );
  const settings = makeSettingsFacade(options.services.settings);

  return Object.freeze({
    api: Object.freeze({
      ...options.services,
      army: options.services.army,
      events,
      packet,
      player,
      players,
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
