import { Context, Effect, Layer } from "effect";

import type { AuraRecord, PlayerRecord } from "../Types";
import { equalsIgnoreCase } from "../payload";
import { WorldState } from "../state/World";

export interface PlayerAuraApi {
  readonly get: (
    player: string | number,
    auraName: string,
  ) => Effect.Effect<AuraRecord | null>;
  readonly has: (
    player: string | number,
    auraName: string,
  ) => Effect.Effect<boolean>;
}

export interface PlayersApiShape {
  readonly auras: PlayerAuraApi;
  readonly get: (
    selector: string | number,
  ) => Effect.Effect<PlayerRecord | null>;
  readonly getAll: () => Effect.Effect<readonly PlayerRecord[]>;
  readonly getMe: () => Effect.Effect<PlayerRecord | null>;
}

export class PlayersApi extends Context.Service<PlayersApi, PlayersApiShape>()(
  "lucent/game/flash/api/Players",
) {}

export const layer = Layer.effect(
  PlayersApi,
  Effect.gen(function* () {
    const world = yield* WorldState;

    const getAuras = (player: string | number) =>
      Effect.gen(function* () {
        const target = yield* world.getPlayer(player);
        return target === null
          ? []
          : yield* world.getPlayerAuras(target.entityId);
      });

    const auras: PlayerAuraApi = {
      get: (player, auraName) =>
        getAuras(player).pipe(
          Effect.map(
            (auras) =>
              auras.find((aura) => equalsIgnoreCase(aura.name, auraName)) ??
              null,
          ),
        ),
      has: (player, auraName) =>
        auras.get(player, auraName).pipe(Effect.map((aura) => aura !== null)),
    };

    return PlayersApi.of({
      auras,
      get: world.getPlayer,
      getAll: world.getPlayers,
      getMe: world.getMe,
    });
  }),
);
