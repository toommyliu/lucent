import { toPlayerSelector } from "@lucent/game";
import type { LivePlayer, PlayerQuery } from "@lucent/game";
import type { Effect } from "effect";

import type { ApiService } from "../../flash/api/Api";

export interface ScriptPlayersApi {
  readonly get: (selector: PlayerQuery) => Effect.Effect<LivePlayer | null>;
  readonly getAll: () => Effect.Effect<LivePlayer[]>;
  readonly getMe: () => Effect.Effect<LivePlayer | null>;
}

export const makeScriptPlayersApi = (
  players: Pick<ApiService["players"], "get" | "getAll">,
  getMe: ApiService["players"]["getMe"],
): ScriptPlayersApi => ({
  get: (selector) => players.get(toPlayerSelector(selector).username),
  getAll: players.getAll,
  getMe,
});
