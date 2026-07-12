import type { Store } from "../state/Store";

export const makePlayers = (store: Store) => {
  const get = (selector: string | number) => store.world.getPlayer(selector);
  const getAll = () => store.world.getPlayers;
  const getMe = () => store.world.getMe;

  return {
    get,
    getAll,
    getMe,
  };
};

export type Players = ReturnType<typeof makePlayers>;
