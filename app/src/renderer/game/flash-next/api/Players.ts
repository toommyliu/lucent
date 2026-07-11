import { Effect } from "effect";

import type { Store } from "../state/Store";

export const makePlayers = (store: Store) => ({
  auras: {
    get: (
      player: string | number,
      name: string,
      options?: { kind?: "active" | "passive" },
    ) =>
      store.world.getPlayer(player).pipe(
        Effect.flatMap((current) =>
          current === null
            ? Effect.succeed(null)
            : store.world.getPlayerAuras(current.entityId, options).pipe(
                Effect.map(
                  (auras) =>
                    auras.find(
                      (aura) =>
                        aura.name.localeCompare(name, undefined, {
                          sensitivity: "accent",
                        }) === 0,
                    ) ?? null,
                ),
              ),
        ),
      ),
    getAll: (
      player: string | number,
      options?: { kind?: "active" | "passive" },
    ) =>
      store.world
        .getPlayer(player)
        .pipe(
          Effect.flatMap((current) =>
            current === null
              ? Effect.succeed([])
              : store.world.getPlayerAuras(current.entityId, options),
          ),
        ),
  },
  get: (selector: string | number) => store.world.getPlayer(selector),
  getAll: () => store.world.getPlayers,
  getMe: () => store.world.getMe,
});

export type Players = ReturnType<typeof makePlayers>;
