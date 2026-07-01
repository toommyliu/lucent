import { Context, Effect, Layer, Option, SynchronizedRef } from "effect";

import type {
  AuraRecord,
  MapRecord,
  MonsterRecord,
  MonsterSelector,
  PlayerRecord,
} from "../Types";
import {
  normalizeAuraRecord,
  normalizeMonsterRecord,
  normalizePlayerRecord,
  optionFromNullable,
} from "../payload";
import { monsterMatchesSelector, normalizeMonsterSelector } from "../selectors";

type AuraTarget = "monster" | "player";

interface WorldRuntimeState {
  readonly map: MapRecord;
  readonly monsterAuras: Map<number, Map<string, AuraRecord>>;
  readonly monsters: Map<number, MonsterRecord>;
  readonly playerAuras: Map<number, Map<string, AuraRecord>>;
  readonly playerEntityIds: Map<number, string>;
  readonly players: Map<string, PlayerRecord>;
  selfUsername: string;
}

export interface WorldStateShape {
  readonly addMonster: (monster: MonsterRecord) => Effect.Effect<void>;
  readonly addPlayer: (player: PlayerRecord) => Effect.Effect<void>;
  readonly clear: Effect.Effect<void>;
  readonly clearAuras: (
    target: AuraTarget,
    targetId: number,
  ) => Effect.Effect<void>;
  readonly getMap: Effect.Effect<MapRecord>;
  readonly getMe: Effect.Effect<PlayerRecord | null>;
  readonly getMonster: (
    selector: MonsterSelector,
  ) => Effect.Effect<MonsterRecord | null>;
  readonly getMonsterAuras: (
    monsterMapId: number,
  ) => Effect.Effect<readonly AuraRecord[]>;
  readonly getMonsters: Effect.Effect<readonly MonsterRecord[]>;
  readonly getPlayer: (
    selector: string | number,
  ) => Effect.Effect<PlayerRecord | null>;
  readonly getPlayerAuras: (
    entityId: number,
  ) => Effect.Effect<readonly AuraRecord[]>;
  readonly getPlayers: Effect.Effect<readonly PlayerRecord[]>;
  readonly patchMap: (patch: Partial<MapRecord>) => Effect.Effect<void>;
  readonly patchMonster: (
    monsterMapId: number,
    patch: Partial<MonsterRecord>,
  ) => Effect.Effect<void>;
  readonly patchPlayer: (
    username: string,
    patch: Partial<PlayerRecord>,
  ) => Effect.Effect<void>;
  readonly removeMonster: (monsterMapId: number) => Effect.Effect<void>;
  readonly removePlayer: (username: string) => Effect.Effect<void>;
  readonly setAura: (
    target: AuraTarget,
    targetId: number,
    aura: AuraRecord,
  ) => Effect.Effect<void>;
  readonly setMap: (map: MapRecord) => Effect.Effect<void>;
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

const emptyMap = (): MapRecord => ({ id: 0, name: "", roomNumber: 0 });

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
): Map<string, AuraRecord> => {
  const source = target === "monster" ? state.monsterAuras : state.playerAuras;
  const current = source.get(targetId);
  if (current !== undefined) {
    return current;
  }

  const created = new Map<string, AuraRecord>();
  source.set(targetId, created);
  return created;
};

const getPlayerBySelector = (
  state: WorldRuntimeState,
  selector: string | number,
): PlayerRecord | null => {
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
          state.monsters.set(monster.monsterMapId, monster);
          return state;
        }),
      addPlayer: (player) =>
        SynchronizedRef.update(ref, (state) => {
          const key = playerKey(player.username);
          state.players.set(key, player);
          state.playerEntityIds.set(player.entityId, key);
          return state;
        }),
      clear: SynchronizedRef.update(ref, () => initialState()),
      clearAuras: (target, targetId) =>
        SynchronizedRef.update(ref, (state) => {
          const source =
            target === "monster" ? state.monsterAuras : state.playerAuras;
          source.delete(targetId);
          return state;
        }),
      getMap: SynchronizedRef.get(ref).pipe(Effect.map((state) => state.map)),
      getMe: SynchronizedRef.get(ref).pipe(
        Effect.map((state) =>
          state.selfUsername === ""
            ? null
            : (state.players.get(playerKey(state.selfUsername)) ?? null),
        ),
      ),
      getMonster: (selector) =>
        SynchronizedRef.get(ref).pipe(
          Effect.map((state) => {
            const normalized = normalizeMonsterSelector(selector);
            if (normalized === null) {
              return null;
            }

            return (
              Array.from(state.monsters.values()).find((monster) =>
                monsterMatchesSelector(monster, normalized),
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
      getMonsters: SynchronizedRef.get(ref).pipe(
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
      getPlayers: SynchronizedRef.get(ref).pipe(
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
            state.monsters.set(monsterMapId, { ...current, ...patch });
          }
          return state;
        }),
      patchPlayer: (username, patch) =>
        SynchronizedRef.update(ref, (state) => {
          const key = playerKey(username);
          const current = state.players.get(key);
          if (current !== undefined) {
            const next = { ...current, ...patch };
            state.players.set(key, next);
            state.playerEntityIds.set(next.entityId, key);
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
          getAuraMap(state, target, targetId).set(
            aura.name.toLowerCase(),
            aura,
          );
          return state;
        }),
      setMap: (map) =>
        SynchronizedRef.update(ref, (state) => {
          Object.assign(state.map, map);
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
): Partial<MapRecord> => {
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

export const decodePlayer = (value: unknown): Option.Option<PlayerRecord> =>
  optionFromNullable(normalizePlayerRecord(value));

export const decodeMonster = (
  value: unknown,
  defaults?: Partial<MonsterRecord>,
): Option.Option<MonsterRecord> =>
  optionFromNullable(normalizeMonsterRecord(value, defaults));

export const decodeAura = (value: unknown): Option.Option<AuraRecord> =>
  optionFromNullable(normalizeAuraRecord(value));
