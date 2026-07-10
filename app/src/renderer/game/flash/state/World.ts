import { Context, Effect, Layer, Option, SynchronizedRef } from "effect";

import type { Aura, MapInfo, Monster, MonsterSelector, Player } from "../Types";
import type { MonsterData, PlayerData } from "@lucent/game";
import { LiveAura, LiveMonster, LivePlayer } from "@lucent/game";
import {
  decodeAuraModel,
  decodeMonsterModel,
  decodePlayerModel,
  optionFromNullable,
} from "../payload";

type AuraTarget = "monster" | "player";

interface WorldRuntimeState {
  readonly map: MapInfo;
  readonly monsterAuras: Map<number, Map<string, LiveAura>>;
  readonly monsters: Map<number, LiveMonster>;
  readonly playerAuras: Map<number, Map<string, LiveAura>>;
  readonly playerEntityIds: Map<number, string>;
  readonly players: Map<string, LivePlayer>;
  selfUsername: string;
}

export interface WorldStateShape {
  readonly addMonster: (monster: LiveMonster) => Effect.Effect<void>;
  readonly addPlayer: (player: LivePlayer) => Effect.Effect<void>;
  readonly clear: () => Effect.Effect<void>;
  readonly clearAuras: (
    target: AuraTarget,
    targetId: number,
  ) => Effect.Effect<void>;
  readonly clearMonsters: () => Effect.Effect<void>;
  readonly clearPlayers: () => Effect.Effect<void>;
  readonly getMap: () => Effect.Effect<MapInfo>;
  readonly getMe: () => Effect.Effect<Player | null>;
  readonly getMonster: (
    selector: MonsterSelector,
  ) => Effect.Effect<Monster | null>;
  readonly getMonsterAuras: (
    monsterMapId: number,
  ) => Effect.Effect<readonly Aura[]>;
  readonly getMonsters: () => Effect.Effect<readonly Monster[]>;
  readonly getPlayer: (
    selector: string | number,
  ) => Effect.Effect<Player | null>;
  readonly getPlayerAuras: (entityId: number) => Effect.Effect<readonly Aura[]>;
  readonly getPlayerAuraTargetsByName: (
    auraName: string,
  ) => Effect.Effect<readonly number[]>;
  readonly getPlayers: () => Effect.Effect<readonly Player[]>;
  readonly patchMap: (patch: Partial<MapInfo>) => Effect.Effect<void>;
  readonly patchMonster: (
    monsterMapId: number,
    patch: Partial<MonsterData>,
  ) => Effect.Effect<void>;
  readonly patchPlayer: (
    username: string,
    patch: Partial<PlayerData>,
  ) => Effect.Effect<void>;
  readonly removeMonster: (monsterMapId: number) => Effect.Effect<void>;
  readonly removePlayer: (username: string) => Effect.Effect<void>;
  readonly setAura: (
    target: AuraTarget,
    targetId: number,
    aura: LiveAura,
  ) => Effect.Effect<void>;
  readonly setMap: (map: MapInfo) => Effect.Effect<void>;
  readonly setMonsters: (
    monsters: readonly LiveMonster[],
  ) => Effect.Effect<void>;
  readonly setPlayers: (players: readonly LivePlayer[]) => Effect.Effect<void>;
  readonly setSelf: (username: string) => Effect.Effect<void>;
  readonly unsetAura: (
    target: AuraTarget,
    targetId: number,
    auraName: string,
  ) => Effect.Effect<void>;
}

export class WorldState extends Context.Service<WorldState, WorldStateShape>()(
  "lucent/game/flash/state/World",
) {}

const emptyMap = (): MapInfo => ({ id: 0, name: "", roomNumber: 0 });

const initialState = (): WorldRuntimeState => ({
  map: emptyMap(),
  monsterAuras: new Map(),
  monsters: new Map(),
  playerAuras: new Map(),
  playerEntityIds: new Map(),
  players: new Map(),
  selfUsername: "",
});

const playerKey = (username: string): string => username.trim().toLowerCase();

const getAuraMap = (
  state: WorldRuntimeState,
  target: AuraTarget,
  targetId: number,
): Map<string, LiveAura> => {
  const source = target === "monster" ? state.monsterAuras : state.playerAuras;
  const current = source.get(targetId);
  if (current !== undefined) {
    return current;
  }

  const created = new Map<string, LiveAura>();
  source.set(targetId, created);
  return created;
};

const getPlayerBySelector = (
  state: WorldRuntimeState,
  selector: string | number,
): Player | null => {
  if (typeof selector === "number") {
    const username = state.playerEntityIds.get(selector);
    return username === undefined
      ? null
      : (state.players.get(username) ?? null);
  }

  return state.players.get(playerKey(selector)) ?? null;
};

export const layer = Layer.effect(
  WorldState,
  Effect.gen(function* () {
    const ref = yield* SynchronizedRef.make(initialState());

    return WorldState.of({
      addMonster: (monster) =>
        SynchronizedRef.update(ref, (state) => {
          const current = state.monsters.get(monster.monsterMapId);
          if (current === undefined)
            state.monsters.set(monster.monsterMapId, monster);
          else current.replaceFrom(monster);
          return state;
        }),
      addPlayer: (player) =>
        SynchronizedRef.update(ref, (state) => {
          const key = playerKey(player.username);
          const current = state.players.get(key);
          if (current === undefined) state.players.set(key, player);
          else current.replaceFrom(player);
          state.playerEntityIds.set((current ?? player).entityId, key);
          return state;
        }),
      clear: () => SynchronizedRef.update(ref, () => initialState()),
      clearAuras: (target, targetId) =>
        SynchronizedRef.update(ref, (state) => {
          const source =
            target === "monster" ? state.monsterAuras : state.playerAuras;
          source.delete(targetId);
          return state;
        }),
      clearMonsters: () =>
        SynchronizedRef.update(ref, (state) => {
          state.monsters.clear();
          state.monsterAuras.clear();
          return state;
        }),
      clearPlayers: () =>
        SynchronizedRef.update(ref, (state) => {
          state.players.clear();
          state.playerEntityIds.clear();
          state.playerAuras.clear();
          return state;
        }),
      getMap: () =>
        SynchronizedRef.get(ref).pipe(Effect.map((state) => state.map)),
      getMe: () =>
        SynchronizedRef.get(ref).pipe(
          Effect.map((state) =>
            state.selfUsername === ""
              ? null
              : (state.players.get(playerKey(state.selfUsername)) ?? null),
          ),
        ),
      getMonster: (selector) =>
        SynchronizedRef.get(ref).pipe(
          Effect.map((state) => {
            return (
              Array.from(state.monsters.values()).find((monster) =>
                monster.matches(selector),
              ) ?? null
            );
          }),
        ),
      getMonsterAuras: (monsterMapId) =>
        SynchronizedRef.get(ref).pipe(
          Effect.map((state) =>
            Array.from(state.monsterAuras.get(monsterMapId)?.values() ?? []),
          ),
        ),
      getMonsters: () =>
        SynchronizedRef.get(ref).pipe(
          Effect.map((state) => Array.from(state.monsters.values())),
        ),
      getPlayer: (selector) =>
        SynchronizedRef.get(ref).pipe(
          Effect.map((state) => getPlayerBySelector(state, selector)),
        ),
      getPlayerAuras: (entityId) =>
        SynchronizedRef.get(ref).pipe(
          Effect.map((state) =>
            Array.from(state.playerAuras.get(entityId)?.values() ?? []),
          ),
        ),
      getPlayerAuraTargetsByName: (auraName) =>
        SynchronizedRef.get(ref).pipe(
          Effect.map((state) => {
            const key = auraName.toLowerCase();
            return Array.from(state.playerAuras.entries()).flatMap(
              ([entityId, auras]) => (auras.has(key) ? [entityId] : []),
            );
          }),
        ),
      getPlayers: () =>
        SynchronizedRef.get(ref).pipe(
          Effect.map((state) => Array.from(state.players.values())),
        ),
      patchMap: (patch) =>
        SynchronizedRef.update(ref, (state) => {
          Object.assign(state.map, patch);
          return state;
        }),
      patchMonster: (monsterMapId, patch) =>
        SynchronizedRef.update(ref, (state) => {
          const current = state.monsters.get(monsterMapId);
          if (current !== undefined) {
            current.update(patch);
          }
          return state;
        }),
      patchPlayer: (username, patch) =>
        SynchronizedRef.update(ref, (state) => {
          const key = playerKey(username);
          const current = state.players.get(key);
          if (current !== undefined) {
            const previousEntityId = current.entityId;
            current.update(patch);
            if (current.entityId !== previousEntityId)
              state.playerEntityIds.delete(previousEntityId);
            state.playerEntityIds.set(current.entityId, key);
          }
          return state;
        }),
      removeMonster: (monsterMapId) =>
        SynchronizedRef.update(ref, (state) => {
          state.monsters.delete(monsterMapId);
          state.monsterAuras.delete(monsterMapId);
          return state;
        }),
      removePlayer: (username) =>
        SynchronizedRef.update(ref, (state) => {
          const key = playerKey(username);
          const current = state.players.get(key);
          if (current !== undefined) {
            state.playerEntityIds.delete(current.entityId);
            state.playerAuras.delete(current.entityId);
          }
          state.players.delete(key);
          return state;
        }),
      setAura: (target, targetId, aura) =>
        SynchronizedRef.update(ref, (state) => {
          const auras = getAuraMap(state, target, targetId);
          const key = aura.name.toLowerCase();
          const current = auras.get(key);
          if (current === undefined) auras.set(key, aura);
          else current.replaceFrom(aura);
          return state;
        }),
      setMap: (map) =>
        SynchronizedRef.update(ref, (state) => {
          const changed =
            state.map.id !== map.id ||
            state.map.name !== map.name ||
            state.map.roomNumber !== map.roomNumber;
          if (changed) {
            state.monsters.clear();
            state.monsterAuras.clear();
            state.players.clear();
            state.playerEntityIds.clear();
            state.playerAuras.clear();
          }
          Object.assign(state.map, map);
          return state;
        }),
      setMonsters: (monsters) =>
        SynchronizedRef.update(ref, (state) => {
          const incoming = new Set(
            monsters.map((monster) => monster.monsterMapId),
          );
          for (const id of state.monsters.keys()) {
            if (!incoming.has(id)) {
              state.monsters.delete(id);
              state.monsterAuras.delete(id);
            }
          }
          for (const monster of monsters) {
            const current = state.monsters.get(monster.monsterMapId);
            if (current === undefined)
              state.monsters.set(monster.monsterMapId, monster);
            else current.replaceFrom(monster);
          }
          return state;
        }),
      setPlayers: (players) =>
        SynchronizedRef.update(ref, (state) => {
          const incoming = new Set(
            players.map((player) => playerKey(player.username)),
          );
          for (const [key, player] of state.players) {
            if (!incoming.has(key)) {
              state.players.delete(key);
              state.playerEntityIds.delete(player.entityId);
              state.playerAuras.delete(player.entityId);
            }
          }
          state.playerEntityIds.clear();
          for (const player of players) {
            const key = playerKey(player.username);
            const current = state.players.get(key);
            if (current === undefined) state.players.set(key, player);
            else current.replaceFrom(player);
            state.playerEntityIds.set((current ?? player).entityId, key);
          }
          return state;
        }),
      setSelf: (username) =>
        SynchronizedRef.update(ref, (state) => {
          state.selfUsername = username;
          return state;
        }),
      unsetAura: (target, targetId, auraName) =>
        SynchronizedRef.update(ref, (state) => {
          const source =
            target === "monster" ? state.monsterAuras : state.playerAuras;
          source.get(targetId)?.delete(auraName.toLowerCase());
          return state;
        }),
    });
  }),
);

export const parseMapNameRoom = (
  areaName: string | undefined,
): Partial<MapInfo> => {
  if (areaName === undefined) {
    return {};
  }

  const [name, room] = areaName.split("-");
  const parsedRoomNumber = room === undefined ? undefined : Number(room);
  return {
    ...(name === undefined ? {} : { name }),
    ...(parsedRoomNumber !== undefined && Number.isFinite(parsedRoomNumber)
      ? { roomNumber: parsedRoomNumber }
      : {}),
  };
};

export const decodePlayer = (value: unknown): Option.Option<Player> =>
  optionFromNullable(decodePlayerModel(value));

export const decodeMonster = (
  value: unknown,
  defaults?: Partial<MonsterData>,
): Option.Option<Monster> =>
  optionFromNullable(decodeMonsterModel(value, defaults));

export const decodeAura = (value: unknown): Option.Option<Aura> =>
  optionFromNullable(decodeAuraModel(value));
