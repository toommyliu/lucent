import * as Effect from "effect/Effect";

import type { RoomPolicy } from "@lucent/core/accountSettings";
import type { ApiService } from "../../flash/api/Api";
import { applyRoomPolicy } from "../../flash/domain/MapTarget";
import type { ScriptPlayerApi, ScriptPlayersApi } from "../ScriptApi";
import { makeScriptPlayersApi } from "./Players";

type ScriptRoomPolicyContext = {
  readonly policy: Effect.Effect<RoomPolicy>;
};

const makeScriptPlayerJoinMap = (
  joinMap: ApiService["player"]["joinMap"],
  script: ScriptRoomPolicyContext,
): ApiService["player"]["joinMap"] =>
  Effect.fn("ScriptPlayer.joinMap")(function* (map, options) {
    const policy = yield* script.policy;
    return yield* joinMap(yield* applyRoomPolicy(map, policy), options);
  });

export const makeScriptPlayerApis = (
  player: ApiService["player"],
  players: ApiService["players"],
  script: ScriptRoomPolicyContext,
): {
  readonly player: ScriptPlayerApi;
  readonly players: ScriptPlayersApi;
} => {
  const auras = Object.freeze({
    get: player.auras.get,
    getAll: player.auras.getAll,
    has: player.auras.has,
  });
  const factions = Object.freeze({
    get: player.factions.get,
    getAll: player.factions.getAll,
  });
  const outfits = Object.freeze({
    equip: player.outfits.equip,
    get: player.outfits.get,
    getAll: player.outfits.getAll,
    wear: player.outfits.wear,
  });
  const playerApi: ScriptPlayerApi = Object.freeze({
    auras,
    factions,
    get: player.get,
    getCell: player.getCell,
    getClassName: player.getClassName,
    getClassRank: player.getClassRank,
    getGender: player.getGender,
    getGold: player.getGold,
    getHp: player.getHp,
    getLevel: player.getLevel,
    getMaxHp: player.getMaxHp,
    getMaxMp: player.getMaxMp,
    getMp: player.getMp,
    getPad: player.getPad,
    getPosition: player.getPosition,
    getState: player.getState,
    goToPlayer: player.goToPlayer,
    hasActiveBoost: player.hasActiveBoost,
    isAfk: player.isAfk,
    isAlive: player.isAlive,
    isMember: player.isMember,
    isReady: player.isReady,
    joinMap: makeScriptPlayerJoinMap(
      (map, options) => player.joinMap(map, options),
      script,
    ),
    jumpToCell: player.jumpToCell,
    outfits,
    rest: player.rest,
    walkTo: player.walkTo,
  });

  return {
    player: playerApi,
    players: makeScriptPlayersApi(players),
  };
};
