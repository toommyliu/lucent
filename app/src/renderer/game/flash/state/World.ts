import { Context, Effect, Layer, Option, SynchronizedRef } from "effect";

import type {
  Aura,
  AuraKind,
  AuraQueryOptions,
  MonsterData,
  PlayerData,
} from "@lucent/game";
import { EntityState, LiveAura, LiveMonster, LivePlayer } from "@lucent/game";
import type { MapInfo, Monster, MonsterSelector, Player } from "../Types";
import {
  decodeAuraModel,
  decodeMonsterModel,
  decodePlayerModel,
  optionFromNullable,
} from "../payload";
import {
  addAuraToState,
  applyMonsterPatch,
  applyPlayerPatch,
  cloneMonster,
  getAuraSource as targetAuraSource,
  getPlayerBySelector,
  initialWorldState as initialState,
  makeAuraKey as auraKey,
  normalizePlayerKey as playerKey,
  putMonsterInState as putMonster,
  putPlayerInState as putPlayer,
  reduceCombatStateInState as reduceCombatState,
  refreshAuraInState,
  registerPlayerIdentityInState as registerPlayerIdentity,
  removeAurasFromState,
  removeMonsterFromState,
  removePlayerFromState,
  resolveAuraKind as auraKind,
} from "./WorldReconciliation";

export type AuraTarget = "monster" | "player";

export interface AreaStateReplacement {
  readonly map: MapInfo;
  readonly monsters: readonly LiveMonster[];
  readonly players: readonly LivePlayer[];
  readonly selfUsername: string | null | undefined;
}

export interface EntityPatchResult<Entity> {
  readonly becameDead: boolean;
  readonly entity: Entity;
}

export interface AuraUpsertResult {
  readonly aura: Aura;
  readonly remainingStack: number;
}

export interface AuraRemovalResult {
  readonly auraName: string;
  readonly kind: AuraKind;
  readonly remainingStack: number;
}

export interface PlayerStatePatch {
  readonly patch: Partial<PlayerData>;
  readonly username: string;
}

export interface MonsterStatePatch {
  readonly monsterMapId: number;
  readonly patch: Partial<MonsterData>;
}

export type CombatAuraMutation =
  | {
      readonly aura: LiveAura;
      readonly operation: "add" | "refresh";
      readonly targetId: number;
      readonly targetType: AuraTarget;
    }
  | {
      readonly auraName: string;
      readonly kind: AuraKind;
      readonly operation: "remove";
      readonly targetId: number;
      readonly targetType: AuraTarget;
    };

export interface CombatStateUpdate {
  readonly auraMutations: readonly CombatAuraMutation[];
  readonly monsterPatches: readonly MonsterStatePatch[];
  readonly playerPatches: readonly PlayerStatePatch[];
}

export interface PlayerDeathState {
  readonly cell: string;
  readonly entityId: number;
  readonly hp: number;
  readonly isSelf: boolean;
  readonly pad: string;
  readonly state: EntityState;
  readonly username: string;
}

export interface MonsterDeathState {
  readonly monsterMapId: number;
}

export type CombatAuraChange =
  | {
      readonly aura: Aura;
      readonly kind: AuraKind;
      readonly operation: "added" | "refreshed";
      readonly targetId: number;
      readonly targetType: AuraTarget;
    }
  | {
      readonly auraName: string;
      readonly kind: AuraKind;
      readonly operation: "removed";
      readonly remainingStack: number;
      readonly targetId: number;
      readonly targetType: AuraTarget;
    };

export type CombatAuraStateChange = CombatAuraChange;

export interface CombatStateResult {
  readonly auraChanges: readonly CombatAuraChange[];
  readonly monsterDeaths: readonly MonsterDeathState[];
  readonly playerDeaths: readonly PlayerDeathState[];
}

export interface WorldStateShape {
  readonly addAura: (
    target: AuraTarget,
    targetId: number,
    aura: LiveAura,
  ) => Effect.Effect<AuraUpsertResult | null>;
  readonly addMonster: (monster: LiveMonster) => Effect.Effect<void>;
  readonly addPlayer: (player: LivePlayer) => Effect.Effect<void>;
  readonly clear: () => Effect.Effect<void>;
  readonly clearAuras: (
    target: AuraTarget,
    targetId: number,
    options?: AuraQueryOptions,
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
    options?: AuraQueryOptions,
  ) => Effect.Effect<readonly Aura[]>;
  readonly getMonsters: () => Effect.Effect<readonly Monster[]>;
  readonly getPlayer: (
    selector: string | number,
  ) => Effect.Effect<Player | null>;
  readonly getPlayerAuras: (
    entityId: number,
    options?: AuraQueryOptions,
  ) => Effect.Effect<readonly Aura[]>;
  readonly getPlayerAuraTargetsByName: (
    auraName: string,
    options?: AuraQueryOptions,
  ) => Effect.Effect<readonly number[]>;
  readonly getPlayerEntityId: (
    username: string,
  ) => Effect.Effect<number | null>;
  readonly getPlayers: () => Effect.Effect<readonly Player[]>;
  readonly patchMap: (patch: Partial<MapInfo>) => Effect.Effect<void>;
  readonly patchMonster: (
    monsterMapId: number,
    patch: Partial<MonsterData>,
  ) => Effect.Effect<EntityPatchResult<Monster> | null>;
  readonly patchPlayer: (
    username: string,
    patch: Partial<PlayerData>,
  ) => Effect.Effect<EntityPatchResult<Player> | null>;
  readonly reduceCombatState: (
    update: CombatStateUpdate,
  ) => Effect.Effect<CombatStateResult>;
  readonly refreshAura: (
    target: AuraTarget,
    targetId: number,
    aura: LiveAura,
  ) => Effect.Effect<AuraUpsertResult | null>;
  readonly registerPlayerIdentity: (
    username: string,
    entityId: number,
  ) => Effect.Effect<void>;
  readonly removeAura: (
    target: AuraTarget,
    targetId: number,
    auraName: string,
    kind?: AuraKind,
  ) => Effect.Effect<readonly AuraRemovalResult[]>;
  readonly removeMonster: (
    monsterMapId: number,
  ) => Effect.Effect<Monster | null>;
  readonly removePlayer: (username: string) => Effect.Effect<Player | null>;
  readonly replaceArea: (area: AreaStateReplacement) => Effect.Effect<void>;
  readonly respawnMonster: (
    monsterMapId: number,
  ) => Effect.Effect<Monster | null>;
  readonly setAura: (
    target: AuraTarget,
    targetId: number,
    aura: LiveAura,
  ) => Effect.Effect<AuraUpsertResult | null>;
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
    kind?: AuraKind,
  ) => Effect.Effect<readonly AuraRemovalResult[]>;
}

export class WorldState extends Context.Service<WorldState, WorldStateShape>()(
  "lucent/game/flash/state/World",
) {}

export const layer = Layer.effect(
  WorldState,
  Effect.gen(function* () {
    const ref = yield* SynchronizedRef.make(initialState());

    const addAura: WorldStateShape["addAura"] = (target, targetId, aura) =>
      SynchronizedRef.modify(ref, (state) => [
        addAuraToState(state, target, targetId, aura),
        state,
      ]);
    const refreshAura: WorldStateShape["refreshAura"] = (
      target,
      targetId,
      aura,
    ) =>
      SynchronizedRef.modify(ref, (state) => [
        refreshAuraInState(state, target, targetId, aura),
        state,
      ]);
    const removeAura: WorldStateShape["removeAura"] = (
      target,
      targetId,
      auraName,
      kind,
    ) =>
      SynchronizedRef.modify(ref, (state) => [
        removeAurasFromState(state, target, targetId, auraName, kind),
        state,
      ]);

    return WorldState.of({
      addAura,
      addMonster: (monster) =>
        SynchronizedRef.update(ref, (state) => {
          putMonster(state, monster);
          return state;
        }),
      addPlayer: (player) =>
        SynchronizedRef.update(ref, (state) => {
          putPlayer(state, player);
          return state;
        }),
      clear: () => SynchronizedRef.update(ref, () => initialState()),
      clearAuras: (target, targetId, options) =>
        SynchronizedRef.update(ref, (state) => {
          const source = targetAuraSource(state, target);
          if (options?.kind === undefined) {
            source.delete(targetId);
            return state;
          }

          const auras = source.get(targetId);
          if (auras === undefined) return state;
          for (const [key, aura] of auras) {
            if (aura.kind === options.kind) auras.delete(key);
          }
          if (auras.size === 0) source.delete(targetId);
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
          state.playerIdsByUsername.clear();
          state.playerAuras.clear();
          state.selfUsername = "";
          return state;
        }),
      getMap: () =>
        SynchronizedRef.get(ref).pipe(
          Effect.map((state) => ({ ...state.map })),
        ),
      getMe: () =>
        SynchronizedRef.get(ref).pipe(
          Effect.map((state) =>
            state.selfUsername === ""
              ? null
              : (state.players.get(state.selfUsername) ?? null),
          ),
        ),
      getMonster: (selector) =>
        SynchronizedRef.get(ref).pipe(
          Effect.map(
            (state) =>
              Array.from(state.monsters.values()).find((monster) =>
                monster.matches(selector),
              ) ?? null,
          ),
        ),
      getMonsterAuras: (monsterMapId, options) =>
        SynchronizedRef.get(ref).pipe(
          Effect.map((state) =>
            Array.from(
              state.monsterAuras.get(monsterMapId)?.values() ?? [],
            ).filter((aura) => aura.kind === auraKind(options)),
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
      getPlayerAuras: (entityId, options) =>
        SynchronizedRef.get(ref).pipe(
          Effect.map((state) =>
            Array.from(state.playerAuras.get(entityId)?.values() ?? []).filter(
              (aura) => aura.kind === auraKind(options),
            ),
          ),
        ),
      getPlayerAuraTargetsByName: (auraName, options) =>
        SynchronizedRef.get(ref).pipe(
          Effect.map((state) => {
            const key = auraKey(auraKind(options), auraName);
            return Array.from(state.playerAuras.entries()).flatMap(
              ([entityId, auras]) => (auras.has(key) ? [entityId] : []),
            );
          }),
        ),
      getPlayerEntityId: (username) =>
        SynchronizedRef.get(ref).pipe(
          Effect.map(
            (state) =>
              state.playerIdsByUsername.get(playerKey(username)) ?? null,
          ),
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
        SynchronizedRef.modify(ref, (state) => [
          applyMonsterPatch(state, monsterMapId, patch),
          state,
        ]),
      patchPlayer: (username, patch) =>
        SynchronizedRef.modify(ref, (state) => [
          applyPlayerPatch(state, username, patch),
          state,
        ]),
      reduceCombatState: (update) =>
        SynchronizedRef.modify(ref, (state) => [
          reduceCombatState(state, update),
          state,
        ]),
      refreshAura,
      registerPlayerIdentity: (username, entityId) =>
        SynchronizedRef.update(ref, (state) => {
          registerPlayerIdentity(state, username, entityId);
          return state;
        }),
      removeAura,
      removeMonster: (monsterMapId) =>
        SynchronizedRef.modify(ref, (state) => [
          removeMonsterFromState(state, monsterMapId),
          state,
        ]),
      removePlayer: (username) =>
        SynchronizedRef.modify(ref, (state) => [
          removePlayerFromState(state, username),
          state,
        ]),
      replaceArea: (area) =>
        SynchronizedRef.update(ref, (state) => {
          Object.assign(state.map, area.map);
          state.monsterAuras.clear();
          state.playerAuras.clear();
          const incomingMonsterIds = new Set(
            area.monsters.map((monster) => monster.monsterMapId),
          );
          for (const monsterMapId of state.monsters.keys()) {
            if (!incomingMonsterIds.has(monsterMapId)) {
              state.monsters.delete(monsterMapId);
            }
          }
          const incomingPlayerKeys = new Set(
            area.players.map((player) => playerKey(player.username)),
          );
          for (const username of state.players.keys()) {
            if (!incomingPlayerKeys.has(username))
              state.players.delete(username);
          }
          state.playerEntityIds.clear();
          state.playerIdsByUsername.clear();
          state.selfUsername = "";
          for (const monster of area.monsters) putMonster(state, monster);
          for (const player of area.players) putPlayer(state, player);
          const selfKey =
            area.selfUsername == null ? "" : playerKey(area.selfUsername);
          state.selfUsername = state.players.has(selfKey) ? selfKey : "";
          return state;
        }),
      respawnMonster: (monsterMapId) =>
        SynchronizedRef.modify(ref, (state) => {
          const monster = state.monsters.get(monsterMapId);
          if (monster === undefined) return [null, state];
          monster.update({
            hp: monster.maxHp,
            mp: monster.maxMp,
            state: EntityState.Idle,
          });
          state.monsterAuras.delete(monsterMapId);
          return [cloneMonster(monster), state];
        }),
      setAura: refreshAura,
      setMap: (map) =>
        SynchronizedRef.update(ref, (state) => {
          Object.assign(state.map, map);
          return state;
        }),
      setMonsters: (monsters) =>
        SynchronizedRef.update(ref, (state) => {
          const incoming = new Set(
            monsters.map((monster) => monster.monsterMapId),
          );
          for (const id of state.monsters.keys()) {
            if (!incoming.has(id)) removeMonsterFromState(state, id);
          }
          for (const monster of monsters) putMonster(state, monster);
          return state;
        }),
      setPlayers: (players) =>
        SynchronizedRef.update(ref, (state) => {
          const incoming = new Set(
            players.map((player) => playerKey(player.username)),
          );
          for (const key of state.players.keys()) {
            if (!incoming.has(key)) removePlayerFromState(state, key);
          }
          for (const player of players) putPlayer(state, player);
          return state;
        }),
      setSelf: (username) =>
        SynchronizedRef.update(ref, (state) => {
          state.selfUsername = playerKey(username);
          return state;
        }),
      unsetAura: removeAura,
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
