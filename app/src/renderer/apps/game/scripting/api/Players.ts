import { toPlayerSelector } from "@lucent/game";

import type { ApiService } from "../../flash/api/Api";
import type { ScriptPlayersApi } from "../ScriptApi";

export const makeScriptPlayersApi = (
  players: Pick<ApiService["players"], "get" | "getAll">,
  getMe: ApiService["players"]["getMe"],
): ScriptPlayersApi =>
  Object.freeze({
    get: (selector: Parameters<ScriptPlayersApi["get"]>[0]) =>
      players.get(toPlayerSelector(selector).username),
    getAll: players.getAll,
    getMe,
  });
