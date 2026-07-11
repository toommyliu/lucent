import { Cause, Effect } from "effect";

import type { ArmyApiShape } from "../army/Army";
import type { AuthApiShape } from "../flash/api/Auth";
import type { BankApiShape } from "../flash/api/Bank";
import type { CombatApiShape } from "../flash/api/Combat";
import type { DropsApiShape } from "../flash/api/Drops";
import type { EventsApiShape, FlashEventHandler } from "../flash/api/Events";
import type { HouseApiShape } from "../flash/api/House";
import type { InventoryApiShape } from "../flash/api/Inventory";
import type { MapApiShape } from "../flash/api/Map";
import type { MonstersApiShape } from "../flash/api/Monsters";
import type { PacketApiShape, PacketHandler } from "../flash/api/Packet";
import type { PlayerApiShape } from "../flash/api/Player";
import type { PlayersApiShape } from "../flash/api/Players";
import type { QuestsApiShape } from "../flash/api/Quests";
import type { SettingsApiShape } from "../flash/api/Settings";
import type { ShopsApiShape } from "../flash/api/Shops";
import type { TempInventoryApiShape } from "../flash/api/TempInventory";
import type { WaitApiShape } from "../flash/api/Wait";
import { randomPrivateRoomNumber, withPrivateRoom } from "../flash/MapTarget";
import type { AutoReloginShape } from "../flash/features/AutoRelogin";
import type { AutoZoneShape } from "../flash/features/AutoZone";
import type { FlashEvent, FlashPacket } from "../flash/Types";
import type {
  ScriptCallbackResult,
  ScriptLucentStd,
  ScriptRuntimeApi,
  ScriptSettingsApi,
} from "./ScriptApi";
import type { ScriptAsyncScope } from "./scriptAsyncScope";
import { ScriptExecutionError } from "./ScriptRunnerErrors";

export interface ScriptRuntimeServices {
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
  readonly settings: SettingsApiShape;
  readonly shops: ShopsApiShape;
  readonly tempInventory: TempInventoryApiShape;
  readonly wait: WaitApiShape;
}

export interface ScriptRuntimeFeatures {
  readonly autoRelogin: AutoReloginShape;
  readonly autoZone: AutoZoneShape;
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

    const room = yield* randomPrivateRoomNumber();
    return withPrivateRoom(trimmed, room);
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
  events: EventsApiShape,
  scope: ScriptAsyncScope,
  failCause: (cause: Cause.Cause<unknown>) => Effect.Effect<void>,
): EventsApiShape => ({
  ...events,
  on: (selector, handler) =>
    events
      .on(
        selector,
        notifyCallbackFailure(
          handler as unknown as (event: FlashEvent) => ScriptCallbackResult,
          failCause,
        ) as FlashEventHandler,
      )
      .pipe(Effect.tap((dispose) => scope.addCleanup(dispose))),
});

const wrapPacket = (
  packet: PacketApiShape,
  scope: ScriptAsyncScope,
  failCause: (cause: Cause.Cause<unknown>) => Effect.Effect<void>,
): PacketApiShape => ({
  ...packet,
  on: (selector, handler) =>
    packet
      .on(
        selector,
        notifyCallbackFailure(
          handler as unknown as (packet: FlashPacket) => ScriptCallbackResult,
          failCause,
        ) as PacketHandler,
      )
      .pipe(Effect.tap((dispose) => scope.addCleanup(dispose))),
});

const makeScriptPlayerJoinMap =
  (
    joinMap: PlayerApiShape["joinMap"],
    script: ScriptPrivateRoomContext,
  ): PlayerApiShape["joinMap"] =>
  (map, cell, pad) =>
    applyPrivateRoom(map, script).pipe(
      Effect.flatMap((targetMap) => joinMap(targetMap, cell, pad)),
    );

export const makeScriptPlayerFacades = <
  PlayerSource extends Pick<PlayerApiShape, "get" | "joinMap">,
  PlayersSource extends Pick<PlayersApiShape, "getMe">,
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

const makeSettingsFacade = (settings: SettingsApiShape): ScriptSettingsApi =>
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
