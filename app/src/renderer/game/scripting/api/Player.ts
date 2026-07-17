import { Effect } from "effect";

import type { ApiService } from "../../flash/api/Api";
import { applyPrivateRoom } from "../../flash/domain/MapTarget";
import type { ScriptRuntimeApi } from "../ScriptApi";
import { makeScriptPlayersApi } from "./Players";

type ScriptPrivateRoomContext = {
  readonly options: Pick<ScriptRuntimeApi["options"], "getUsePrivateRooms">;
};

const makeScriptPlayerJoinMap = (
  joinMap: ApiService["player"]["joinMap"],
  script: ScriptPrivateRoomContext,
): ApiService["player"]["joinMap"] =>
  Effect.fn("ScriptPlayer.joinMap")(function* (map, cell, pad) {
    const usePrivateRooms = yield* script.options.getUsePrivateRooms();
    return yield* joinMap(
      yield* applyPrivateRoom(map, usePrivateRooms),
      cell,
      pad,
    );
  });

export const makeScriptPlayerApis = <
  PlayerSource extends Pick<ApiService["player"], "get" | "joinMap">,
  PlayersSource extends Pick<ApiService["players"], "get" | "getAll" | "getMe">,
>(
  player: PlayerSource,
  players: PlayersSource,
  script: ScriptPrivateRoomContext,
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
