import type { LiveAura, LiveMonster, LivePlayer } from "@lucent/game";

export interface MapState {
  id: number;
  name: string;
  roomNumber: number;
}

export interface WorldState {
  readonly cellPads: string[];
  readonly cells: string[];
  readonly map: MapState;
  readonly monsterAuras: Map<number, Map<string, LiveAura>>;
  readonly monsters: Map<number, LiveMonster>;
  readonly playerAuras: Map<number, Map<string, LiveAura>>;
  readonly playerIds: Map<number, string>;
  readonly players: Map<string, LivePlayer>;
  self: string;
  selfEntityId: number | null;
}

export const normalizeUsername = (username: string): string =>
  username.trim().toLowerCase();

export const auraKey = (aura: Pick<LiveAura, "kind" | "name">): string =>
  `${aura.kind}:${aura.name.trim().toLowerCase()}`;

export const makeWorldState = (): WorldState => ({
  cellPads: [],
  cells: [],
  map: { id: 0, name: "", roomNumber: 0 },
  monsterAuras: new Map(),
  monsters: new Map(),
  playerAuras: new Map(),
  playerIds: new Map(),
  players: new Map(),
  self: "",
  selfEntityId: null,
});

export const clearArea = (state: WorldState): void => {
  state.cellPads.length = 0;
  state.cells.length = 0;
  state.map.id = 0;
  state.map.name = "";
  state.map.roomNumber = 0;
  state.monsterAuras.clear();
  state.monsters.clear();
  state.playerAuras.clear();
  state.playerIds.clear();
  state.players.clear();
};

export const putPlayer = (
  state: WorldState,
  incoming: LivePlayer,
): LivePlayer => {
  const key = normalizeUsername(incoming.username);
  const current = state.players.get(key);
  if (current === undefined) state.players.set(key, incoming);
  else current.replaceFrom(incoming);
  state.playerIds.set(incoming.entityId, key);
  return current ?? incoming;
};

export const putMonster = (
  state: WorldState,
  incoming: LiveMonster,
): LiveMonster => {
  const current = state.monsters.get(incoming.monsterMapId);
  if (current === undefined)
    state.monsters.set(incoming.monsterMapId, incoming);
  else current.replaceFrom(incoming);
  return current ?? incoming;
};
