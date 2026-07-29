import * as Effect from "effect/Effect";

import type { RoomPolicy } from "@lucent/core/accountSettings";
import type { ApiService } from "../../flash/api/Api";
import { applyRoomPolicy } from "../../flash/domain/MapTarget";
import { makeScriptPlayersApi } from "./Players";

type ScriptRoomPolicyContext = {
  readonly policy: Effect.Effect<RoomPolicy>;
};

const makeScriptPlayerJoinMap = (
  joinMap: ApiService["player"]["joinMap"],
  script: ScriptRoomPolicyContext,
): ApiService["player"]["joinMap"] =>
  Effect.fn("ScriptPlayer.joinMap")(function* (map, cell, pad) {
    const policy = yield* script.policy;
    return yield* joinMap(yield* applyRoomPolicy(map, policy), cell, pad);
  });

export const makeScriptPlayerApis = <
  PlayerSource extends Pick<ApiService["player"], "get" | "joinMap">,
  PlayersSource extends Pick<ApiService["players"], "get" | "getAll" | "getMe">,
>(
  player: PlayerSource,
  players: PlayersSource,
  script: ScriptRoomPolicyContext,
) => {
  const playerApi = {
    ...player,
    joinMap: makeScriptPlayerJoinMap(
      (map, cell, pad) => player.joinMap(map, cell, pad),
      script,
    ),
  };

  return {
    player: playerApi,
    players: makeScriptPlayersApi(players, playerApi.get),
  };
};
