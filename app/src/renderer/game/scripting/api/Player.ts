import { Effect } from "effect";

import type { ApiService } from "../../flash/api/Api";
import { privateRoom, randomPrivateRoom } from "../../flash/domain/MapTarget";
import type { ScriptRuntimeApi } from "../ScriptApi";

type ScriptPrivateRoomContext = {
  readonly options: Pick<ScriptRuntimeApi["options"], "getUsePrivateRooms">;
};

const applyPrivateRoom = Effect.fn("applyPrivateRoom")(function* (
  map: string,
  script: ScriptPrivateRoomContext,
) {
  const trimmed = map.trim();
  if (trimmed === "" || !(yield* script.options.getUsePrivateRooms())) {
    return map;
  }

  return privateRoom(trimmed, yield* randomPrivateRoom);
});

const makeScriptPlayerJoinMap = (
  joinMap: ApiService["player"]["joinMap"],
  script: ScriptPrivateRoomContext,
): ApiService["player"]["joinMap"] =>
  Effect.fn("ScriptPlayer.joinMap")(function* (map, cell, pad) {
    return yield* joinMap(yield* applyPrivateRoom(map, script), cell, pad);
  });

export const makeScriptPlayerApis = <
  PlayerSource extends Pick<ApiService["player"], "get" | "joinMap">,
  PlayersSource extends Pick<ApiService["players"], "getMe">,
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
    players: {
      ...players,
      getMe: playerApi.get,
    },
  };
};
