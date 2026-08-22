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
  const playerApi = {
    ...player,
    joinMap: makeScriptPlayerJoinMap(
      (map, options) => player.joinMap(map, options),
      script,
    ),
  };

  return {
    player: playerApi,
    players: makeScriptPlayersApi(players, playerApi.get),
  };
};
