import { Context, Effect, Layer } from "effect";

import type { Aura, AuraQueryOptions, Player } from "../Types";
import { equalsIgnoreCase } from "../payload";
import { WorldState } from "../state/World";

export interface PlayerAuraApi {
  readonly get: (
    player: string | number,
    auraName: string,
    options?: AuraQueryOptions,
  ) => Effect.Effect<Aura | null>;
  readonly getAll: (
    player: string | number,
    options?: AuraQueryOptions,
  ) => Effect.Effect<readonly Aura[]>;
  readonly has: (
    player: string | number,
    auraName: string,
    options?: AuraQueryOptions,
  ) => Effect.Effect<boolean>;
}

export interface PlayersApiShape {
  readonly auras: PlayerAuraApi;
  readonly get: (selector: string | number) => Effect.Effect<Player | null>;
  readonly getAll: () => Effect.Effect<readonly Player[]>;
  readonly getMe: () => Effect.Effect<Player | null>;
}

export class PlayersApi extends Context.Service<PlayersApi, PlayersApiShape>()(
  "lucent/game/flash/api/Players",
) {}

export const layer = Layer.effect(
  PlayersApi,
  Effect.gen(function* () {
    const world = yield* WorldState;

    const getAuras = (player: string | number, options?: AuraQueryOptions) =>
      Effect.gen(function* () {
        const target = yield* world.getPlayer(player);
        return target === null
          ? []
          : yield* world.getPlayerAuras(target.entityId, options);
      });

    const auras: PlayerAuraApi = {
      get: (player, auraName, options) =>
        getAuras(player, options).pipe(
          Effect.map(
            (auras) =>
              auras.find((aura) => equalsIgnoreCase(aura.name, auraName)) ??
              null,
          ),
        ),
      getAll: getAuras,
      has: (player, auraName, options) =>
        auras
          .get(player, auraName, options)
          .pipe(Effect.map((aura) => aura !== null)),
    };

    return PlayersApi.of({
      auras,
      get: world.getPlayer,
      getAll: world.getPlayers,
      getMe: world.getMe,
    });
  }),
);
