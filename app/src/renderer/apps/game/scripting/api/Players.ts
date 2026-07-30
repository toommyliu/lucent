import { toPlayerSelector } from "@lucent/game";

import type { ApiService } from "../../flash/api/Api";
import type { ScriptPlayersApi } from "../ScriptApi";

export const makeScriptPlayersApi = (
  players: Pick<ApiService["players"], "get" | "getAll">,
  getMe: ApiService["players"]["getMe"],
): ScriptPlayersApi => ({
  get: (selector) => players.get(toPlayerSelector(selector).username),
  getAll: players.getAll,
  getMe,
});
