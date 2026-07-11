import { Effect, SubscriptionRef, SynchronizedRef } from "effect";
import type {
  AuraQueryOptions,
  ItemQuery,
  LiveAura,
  LiveItem,
  LiveMonster,
  LivePlayer,
  LiveQuest,
  LiveServer,
  LiveShop,
  MonsterQuery,
  MonsterData,
  PlayerData,
  ShopItemQuery,
} from "@lucent/game";

import { makeAuthState } from "./Auth";
import { makeCombatState } from "./Combat";
import {
  getItem,
  getItems,
  makeItemsState,
  removeItem,
  replaceItems,
  upsertItem,
  type ItemContainer,
} from "./Items";
import { makeQuestsState } from "./Quests";
import { makeSettingsState, type SettingsState } from "./Settings";
import { makeShopsState } from "./Shops";
import {
  auraKey,
  clearArea,
  makeWorldState,
  normalizeUsername,
  putMonster,
  putPlayer,
  type MapState,
} from "./World";

export const makeStore = Effect.gen(function* () {
  const authRef = yield* SynchronizedRef.make(makeAuthState());
  const combatRef = yield* SynchronizedRef.make(makeCombatState());
  const itemsRef = yield* SynchronizedRef.make(makeItemsState());
  const questsRef = yield* SynchronizedRef.make(makeQuestsState());
  const settingsRef = yield* SubscriptionRef.make(makeSettingsState());
  const shopsRef = yield* SynchronizedRef.make(makeShopsState());
  const worldRef = yield* SynchronizedRef.make(makeWorldState());

  const auras = (
    target: "monster" | "player",
    id: number,
    options?: AuraQueryOptions,
  ) =>
    SynchronizedRef.get(worldRef).pipe(
      Effect.map((state) =>
        Array.from(
          (target === "monster" ? state.monsterAuras : state.playerAuras)
            .get(id)
            ?.values() ?? [],
        ).filter(
          (aura) => options?.kind === undefined || aura.kind === options.kind,
        ),
      ),
    );

  return {
    auth: {
      clear: SynchronizedRef.update(authRef, (state) => {
        state.loggedIn = false;
        state.password = "";
        state.username = "";
        state.servers.clear();
        return state;
      }),
      get: SynchronizedRef.get(authRef),
      setCredentials: (username: string, password: string) =>
        SynchronizedRef.update(authRef, (state) => {
          state.username = username;
          state.password = password;
          return state;
        }),
      setLoggedIn: (loggedIn: boolean) =>
        SynchronizedRef.update(authRef, (state) => {
          state.loggedIn = loggedIn;
          return state;
        }),
      setServers: (servers: readonly LiveServer[]) =>
        SynchronizedRef.update(authRef, (state) => {
          const incoming = new Set(servers.map((server) => server.name));
          for (const name of state.servers.keys()) {
            if (!incoming.has(name)) state.servers.delete(name);
          }
          for (const server of servers) {
            const current = state.servers.get(server.name);
            if (current === undefined) state.servers.set(server.name, server);
            else current.replaceFrom(server);
          }
          return state;
        }),
    },
    combat: {
      get: SynchronizedRef.get(combatRef),
      setTarget: (target: { id: number; type: "monster" | "player" } | null) =>
        SynchronizedRef.update(combatRef, (state) => {
          state.target = target;
          return state;
        }),
    },
    items: {
      get: (container: ItemContainer, selector: ItemQuery | ShopItemQuery) =>
        SynchronizedRef.get(itemsRef).pipe(
          Effect.map((state) => getItem(state, container, selector)),
        ),
      getAll: (container: ItemContainer) =>
        SynchronizedRef.get(itemsRef).pipe(
          Effect.map((state) => getItems(state, container)),
        ),
      quantity: (container: ItemContainer, selector: ItemQuery) =>
        SynchronizedRef.get(itemsRef).pipe(
          Effect.map(
            (state) => getItem(state, container, selector)?.quantity ?? 0,
          ),
        ),
      remove: (container: ItemContainer, key: number) =>
        SynchronizedRef.modify(itemsRef, (state) => [
          removeItem(state, container, key),
          state,
        ]),
      replace: (container: ItemContainer, values: readonly LiveItem[]) =>
        SynchronizedRef.update(itemsRef, (state) => {
          replaceItems(state, container, values);
          return state;
        }),
      upsert: (container: ItemContainer, item: LiveItem) =>
        SynchronizedRef.modify(itemsRef, (state) => [
          upsertItem(state, container, item),
          state,
        ]),
    },
    quests: {
      get: (id: number) =>
        SynchronizedRef.get(questsRef).pipe(
          Effect.map((state) => state.quests.get(id) ?? null),
        ),
      getAccepted: SynchronizedRef.get(questsRef).pipe(
        Effect.map((state) =>
          Array.from(state.accepted).flatMap((id) => {
            const quest = state.quests.get(id);
            return quest === undefined ? [] : [quest];
          }),
        ),
      ),
      getAll: SynchronizedRef.get(questsRef).pipe(
        Effect.map((state) => Array.from(state.quests.values())),
      ),
      setAccepted: (ids: readonly number[]) =>
        SynchronizedRef.update(questsRef, (state) => {
          state.accepted.clear();
          for (const id of ids) state.accepted.add(id);
          return state;
        }),
      upsert: (quest: LiveQuest) =>
        SynchronizedRef.update(questsRef, (state) => {
          const current = state.quests.get(quest.id);
          if (current === undefined) state.quests.set(quest.id, quest);
          else current.replaceFrom(quest);
          return state;
        }),
    },
    settings: {
      changes: SubscriptionRef.changes(settingsRef),
      get: SubscriptionRef.get(settingsRef),
      patch: (patch: Partial<SettingsState>) =>
        SubscriptionRef.updateAndGet(settingsRef, (state) => ({
          ...state,
          ...patch,
        })),
    },
    shops: {
      get: SynchronizedRef.get(shopsRef).pipe(
        Effect.map((state) => state.current),
      ),
      set: (shop: LiveShop | null) =>
        SynchronizedRef.update(shopsRef, (state) => {
          if (
            shop === null ||
            state.current === null ||
            state.current.id !== shop.id
          ) {
            state.current = shop;
          } else {
            state.current.replaceFrom(shop);
          }
          return state;
        }),
    },
    world: {
      addAura: (
        target: "monster" | "player",
        id: number,
        aura: LiveAura,
        operation: "add" | "refresh",
      ) =>
        SynchronizedRef.update(worldRef, (state) => {
          const source =
            target === "monster" ? state.monsterAuras : state.playerAuras;
          const values = source.get(id) ?? new Map<string, LiveAura>();
          const key = auraKey(aura);
          const current = values.get(key);
          if (current === undefined) {
            values.set(key, aura);
          } else {
            const stack =
              operation === "add" ? current.stack + 1 : current.stack;
            current.update({ ...aura.toJSON(), stack });
          }
          source.set(id, values);
          return state;
        }),
      clearAuras: (target?: "monster" | "player", id?: number) =>
        SynchronizedRef.update(worldRef, (state) => {
          const sources =
            target === "monster"
              ? [state.monsterAuras]
              : target === "player"
                ? [state.playerAuras]
                : [state.monsterAuras, state.playerAuras];
          for (const source of sources) {
            if (id === undefined) source.clear();
            else source.delete(id);
          }
          return state;
        }),
      clearArea: SynchronizedRef.update(worldRef, (state) => {
        clearArea(state);
        return state;
      }),
      getMap: SynchronizedRef.get(worldRef).pipe(
        Effect.map((state) => ({ ...state.map })),
      ),
      getCellPads: SynchronizedRef.get(worldRef).pipe(
        Effect.map((state) => [...state.cellPads]),
      ),
      getCells: SynchronizedRef.get(worldRef).pipe(
        Effect.map((state) => [...state.cells]),
      ),
      getMe: SynchronizedRef.get(worldRef).pipe(
        Effect.map((state) => state.players.get(state.self) ?? null),
      ),
      getMonster: (selector: MonsterQuery) =>
        SynchronizedRef.get(worldRef).pipe(
          Effect.map(
            (state) =>
              Array.from(state.monsters.values()).find((monster) =>
                monster.matches(selector),
              ) ?? null,
          ),
        ),
      getMonsterAuras: (id: number, options?: AuraQueryOptions) =>
        auras("monster", id, options),
      getMonsters: SynchronizedRef.get(worldRef).pipe(
        Effect.map((state) => Array.from(state.monsters.values())),
      ),
      getPlayer: (selector: string | number) =>
        SynchronizedRef.get(worldRef).pipe(
          Effect.map((state) => {
            const key =
              typeof selector === "number"
                ? state.playerIds.get(selector)
                : normalizeUsername(selector);
            return key === undefined ? null : (state.players.get(key) ?? null);
          }),
        ),
      getPlayerAuras: (id: number, options?: AuraQueryOptions) =>
        auras("player", id, options),
      getPlayers: SynchronizedRef.get(worldRef).pipe(
        Effect.map((state) => Array.from(state.players.values())),
      ),
      putMonster: (monster: LiveMonster) =>
        SynchronizedRef.modify(worldRef, (state) => [
          putMonster(state, monster),
          state,
        ]),
      putPlayer: (player: LivePlayer) =>
        SynchronizedRef.modify(worldRef, (state) => [
          putPlayer(state, player),
          state,
        ]),
      patchMonster: (id: number, patch: Partial<MonsterData>) =>
        SynchronizedRef.modify(worldRef, (state) => {
          const current = state.monsters.get(id);
          if (current === undefined) return [null, state];
          const wasAlive = current.alive;
          current.update(patch);
          return [
            { becameDead: wasAlive && current.dead, monster: current },
            state,
          ];
        }),
      patchPlayer: (username: string, patch: Partial<PlayerData>) =>
        SynchronizedRef.modify(worldRef, (state) => {
          const current = state.players.get(normalizeUsername(username));
          if (current === undefined) return [null, state];
          const wasAlive = current.alive;
          current.update(patch);
          return [
            { becameDead: wasAlive && current.dead, player: current },
            state,
          ];
        }),
      removeAura: (
        target: "monster" | "player",
        id: number,
        name: string,
        kind?: "active" | "passive",
      ) =>
        SynchronizedRef.update(worldRef, (state) => {
          const source =
            target === "monster" ? state.monsterAuras : state.playerAuras;
          const values = source.get(id);
          if (values === undefined) return state;
          for (const [key, aura] of values) {
            if (
              aura.name.localeCompare(name, undefined, {
                sensitivity: "accent",
              }) === 0 &&
              (kind === undefined || aura.kind === kind)
            ) {
              const stack = Math.max(0, aura.stack - 1);
              if (stack === 0) values.delete(key);
              else aura.update({ stack });
            }
          }
          if (values.size === 0) source.delete(id);
          return state;
        }),
      removeMonster: (id: number) =>
        SynchronizedRef.modify(worldRef, (state) => {
          const current = state.monsters.get(id) ?? null;
          state.monsters.delete(id);
          state.monsterAuras.delete(id);
          return [current, state];
        }),
      removePlayer: (username: string) =>
        SynchronizedRef.modify(worldRef, (state) => {
          const key = normalizeUsername(username);
          const current = state.players.get(key) ?? null;
          if (current !== null) {
            state.players.delete(key);
            state.playerIds.delete(current.entityId);
            state.playerAuras.delete(current.entityId);
          }
          return [current, state];
        }),
      setMap: (map: MapState) =>
        SynchronizedRef.update(worldRef, (state) => {
          Object.assign(state.map, map);
          return state;
        }),
      setCellPads: (cellPads: readonly string[]) =>
        SynchronizedRef.update(worldRef, (state) => {
          state.cellPads.splice(0, state.cellPads.length, ...cellPads);
          return state;
        }),
      setCells: (cells: readonly string[]) =>
        SynchronizedRef.update(worldRef, (state) => {
          state.cells.splice(0, state.cells.length, ...cells);
          return state;
        }),
      setMonsters: (monsters: readonly LiveMonster[]) =>
        SynchronizedRef.update(worldRef, (state) => {
          state.monsters.clear();
          state.monsterAuras.clear();
          for (const monster of monsters) putMonster(state, monster);
          return state;
        }),
      setPlayers: (players: readonly LivePlayer[]) =>
        SynchronizedRef.update(worldRef, (state) => {
          state.players.clear();
          state.playerIds.clear();
          state.playerAuras.clear();
          for (const player of players) putPlayer(state, player);
          return state;
        }),
      setSelf: (username: string) =>
        SynchronizedRef.update(worldRef, (state) => {
          state.self = normalizeUsername(username);
          return state;
        }),
    },
  };
});

export type Store = Effect.Success<typeof makeStore>;
