import { Effect } from "effect";

import type { Store } from "../state/Store";

export const makePlayers = (store: Store) => {
  const get = (selector: string | number) => store.world.getPlayer(selector);
  const getAll = () => store.world.getPlayers;
  const getMe = () => store.world.getMe;

  const getAuras = (
    selector: string | number,
    options?: { kind?: "active" | "passive" },
  ) =>
    get(selector).pipe(
      Effect.flatMap((player) =>
        player === null
          ? Effect.succeed([])
          : store.world.getPlayerAuras(player.entityId, options),
      ),
    );

  const getAura = (
    selector: string | number,
    name: string,
    options?: { kind?: "active" | "passive" },
  ) =>
    getAuras(selector, options).pipe(
      Effect.map(
        (auras) =>
          auras.find(
            (aura) =>
              aura.name.localeCompare(name, undefined, {
                sensitivity: "accent",
              }) === 0,
          ) ?? null,
      ),
    );

  const hasAura = (
    selector: string | number,
    name: string,
    options?: { kind?: "active" | "passive" },
  ) =>
    getAura(selector, name, options).pipe(Effect.map((aura) => aura !== null));

  const auras = {
    get: getAura,
    getAll: getAuras,
    has: hasAura,
  };

  return {
    auras,
    get,
    getAll,
    getMe,
  };
};

export type Players = ReturnType<typeof makePlayers>;
