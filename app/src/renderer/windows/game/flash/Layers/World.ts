import { Collection } from "@lucent/collection";
import { Avatar, Monster, parseMonsterMapIdToken } from "@lucent/game";
import type { Aura } from "@lucent/game";
import { equalsIgnoreCase, includesIgnoreCase } from "@lucent/shared/string";
import {
  Effect,
  Layer,
  Option,
  Ref,
  SynchronizedRef,
  type SynchronizedRef as SynchronizedRefType,
} from "effect";
import { Bridge } from "../Services/Bridge";
import { Wait } from "../Services/Wait";
import { World } from "../Services/World";
import { matchesAura } from "../auraMatching";
import type {
  MonsterSelector,
  PlayerSelector,
  WorldEntitiesShape,
  WorldEntity,
  WorldEntityKey,
  WorldEntitySelector,
  WorldMapShape,
  WorldMonstersShape,
  WorldPlayersShape,
  WorldShape,
} from "../Services/World";

type RuntimeState = {
  readonly players: Collection<string, Avatar>;
  readonly playerEntityIds: Map<string, number>;
  readonly playerNamesByEntityId: Map<number, string>;
  meUsername: string | undefined;
  readonly monsters: Collection<number, Monster>;
  readonly playerAuras: Collection<number, Collection<string, Aura>>;
  readonly monsterAuras: Collection<number, Collection<string, Aura>>;
};

const normalize = (value: string) => value.toLowerCase();

const initialState = (): RuntimeState => ({
  players: new Collection<string, Avatar>(),
  playerEntityIds: new Map<string, number>(),
  playerNamesByEntityId: new Map<number, string>(),
  meUsername: undefined,
  monsters: new Collection<number, Monster>(),
  playerAuras: new Collection<number, Collection<string, Aura>>(),
  monsterAuras: new Collection<number, Collection<string, Aura>>(),
});

const mutate = <A>(
  stateRef: SynchronizedRefType.SynchronizedRef<RuntimeState>,
  f: (state: RuntimeState) => A,
): Effect.Effect<A> =>
  SynchronizedRef.modify(stateRef, (state) => [f(state), state] as const);

const getTargetAuras = (
  cache: Collection<number, Collection<string, Aura>>,
  targetId: number,
): Collection<string, Aura> =>
  cache.ensure(targetId, () => new Collection<string, Aura>());

const addAuraToTarget = (
  targetAuras: Collection<string, Aura>,
  aura: Aura,
): void => {
  const auraKey = normalize(aura.name);
  const existing = targetAuras.get(auraKey);
  if (existing) {
    existing.stack = (existing.stack ?? 1) + 1;
    if (aura.duration !== undefined) {
      existing.duration = aura.duration;
    }

    if (aura.cat !== undefined) {
      existing.cat = aura.cat;
    }

    if (aura.icon !== undefined) {
      existing.icon = aura.icon;
    }

    if (aura.value !== undefined) {
      existing.value = aura.value;
    }
    return;
  }

  targetAuras.set(auraKey, { ...aura, stack: aura.stack ?? 1 });
};

const updateAuraOnTarget = (
  targetAuras: Collection<string, Aura>,
  aura: Aura,
): void => {
  const auraKey = normalize(aura.name);
  const existing = targetAuras.get(auraKey);
  if (existing) {
    if (aura.duration !== undefined) {
      existing.duration = aura.duration;
    }

    if (aura.cat !== undefined) {
      existing.cat = aura.cat;
    }

    if (aura.icon !== undefined) {
      existing.icon = aura.icon;
    }

    if (aura.value !== undefined) {
      existing.value = aura.value;
    }
    return;
  }

  targetAuras.set(auraKey, { ...aura, stack: aura.stack ?? 1 });
};

const removeAuraFromTarget = (
  targetAuras: Collection<string, Aura> | undefined,
  auraName: string,
): void => {
  const auraKey = normalize(auraName);
  const existing = targetAuras?.get(auraKey);
  if (!targetAuras || !existing) {
    return;
  }

  const stack = existing.stack ?? 1;
  if (stack > 1) {
    existing.stack = stack - 1;
    return;
  }

  targetAuras.delete(auraKey);
};

const clearRuntimeState = (state: RuntimeState): void => {
  state.players.clear();
  state.playerEntityIds.clear();
  state.playerNamesByEntityId.clear();
  state.meUsername = undefined;
  state.monsters.clear();
  state.playerAuras.clear();
  state.monsterAuras.clear();
};

const optionFromNullable = <A>(value: A | undefined): Option.Option<A> =>
  value === undefined ? Option.none() : Option.some(value);

const cloneAuras = (
  auras: Collection<string, Aura> | undefined,
): Collection<string, Aura> =>
  new Collection(
    auras === undefined
      ? []
      : Array.from(auras, ([key, aura]) => [key, { ...aura }] as const),
  );

const getPlayerByEntId = (
  state: RuntimeState,
  entId: number,
): Avatar | undefined => {
  const key = state.playerNamesByEntityId.get(entId);
  if (key !== undefined) {
    return state.players.get(key);
  }

  return state.players.find((player) => player.data.entID === entId);
};

const getPlayerBySelector = (
  state: RuntimeState,
  selector: PlayerSelector,
): Avatar | undefined => {
  if (typeof selector === "string") {
    return state.players.get(normalize(selector));
  }

  if (typeof selector === "number") {
    return Number.isFinite(selector) ? getPlayerByEntId(state, selector) : undefined;
  }

  const byUsername =
    selector.username === undefined
      ? undefined
      : state.players.get(normalize(selector.username));
  const byEntId =
    selector.entId === undefined
      ? undefined
      : getPlayerByEntId(state, selector.entId);

  if (selector.username !== undefined && selector.entId !== undefined) {
    return byUsername !== undefined && byUsername === byEntId
      ? byUsername
      : undefined;
  }

  return byUsername ?? byEntId;
};

const getMonsterByName = (
  monsters: Collection<number, Monster>,
  name: string,
): Monster | undefined =>
  monsters.find(
    (candidate) => name === "*" || includesIgnoreCase(candidate.name, name),
  );

const monsterMatchesName = (monster: Monster, name: string): boolean =>
  name === "*" || includesIgnoreCase(monster.name, name);

const getMonsterBySelector = (
  state: RuntimeState,
  selector: MonsterSelector,
): Monster | undefined => {
  if (typeof selector === "number" || typeof selector === "string") {
    const monMapId = parseMonsterMapIdToken(selector);
    if (monMapId !== undefined) {
      return state.monsters.get(monMapId);
    }

    return typeof selector === "string"
      ? getMonsterByName(state.monsters, selector)
      : undefined;
  }

  const byMonMapId =
    selector.monMapId === undefined
      ? undefined
      : state.monsters.get(selector.monMapId);
  const byName =
    selector.name === undefined
      ? undefined
      : getMonsterByName(state.monsters, selector.name);

  if (selector.monMapId !== undefined && selector.name !== undefined) {
    return byMonMapId !== undefined &&
      monsterMatchesName(byMonMapId, selector.name)
      ? byMonMapId
      : undefined;
  }

  return byMonMapId ?? byName;
};

const toPlayerEntity = (player: Avatar): WorldEntity => ({
  type: "player",
  key: `player:${player.data.entID}`,
  entId: player.data.entID,
  username: player.username,
  entity: player,
});

const toMonsterEntity = (monster: Monster): WorldEntity => ({
  type: "monster",
  key: `monster:${monster.monMapId}`,
  monMapId: monster.monMapId,
  name: monster.name,
  entity: monster,
});

const getEntityBySelector = (
  state: RuntimeState,
  selector: WorldEntitySelector,
): WorldEntity | undefined => {
  if (selector.type === "self") {
    const player = state.meUsername
      ? state.players.get(state.meUsername)
      : undefined;
    return player === undefined ? undefined : toPlayerEntity(player);
  }

  if (selector.type === "player") {
    const player = getPlayerBySelector(state, selector);
    return player === undefined ? undefined : toPlayerEntity(player);
  }

  const monster = getMonsterBySelector(state, selector);
  return monster === undefined ? undefined : toMonsterEntity(monster);
};

const make = Effect.gen(function* () {
  const bridge = yield* Bridge;
  const wait = yield* Wait;

  const stateRef = yield* SynchronizedRef.make(initialState());
  const runFork = Effect.runForkWith(yield* Effect.services());

  const mapIdRef = yield* Ref.make<number | null>(null);
  const mapNameRef = yield* Ref.make<string | null>(null);
  const roomNumberRef = yield* Ref.make<number | null>(null);

  // Bridge methods
  const getCells: WorldMapShape["getCells"] = () =>
    Effect.map(bridge.call("world.getCells"), (cells) =>
      cells.filter((cell): cell is string => typeof cell === "string"),
    );

  const getCellPads: WorldMapShape["getCellPads"] = () =>
    Effect.map(bridge.call("world.getCellPads"), (pads) =>
      pads.filter((pad): pad is string => typeof pad === "string"),
    );

  const isLoaded: WorldMapShape["isLoaded"] = () =>
    bridge.call("world.isLoaded");

  const getMapItem: WorldMapShape["getMapItem"] = (itemId) =>
    Effect.gen(function* () {
      yield* wait.forGameAction("getMapItem");
      return yield* bridge.call("world.getMapItem", [itemId]);
    });

  const loadSwf: WorldMapShape["loadSwf"] = (path) =>
    bridge.call("world.loadSwf", [path]);

  const reload: WorldMapShape["reload"] = () => bridge.call("world.reload");

  const setSpawnPoint: WorldMapShape["setSpawnPoint"] = (cell, pad) =>
    Effect.gen(function* () {
      if (cell === undefined && pad === undefined) {
        return yield* bridge.call("world.setSpawnPoint");
      }

      if (cell !== undefined && pad === undefined) {
        return yield* bridge.call("world.setSpawnPoint", [cell]);
      }

      if (cell === undefined && pad !== undefined) {
        return yield* bridge.call("world.setSpawnPoint", [undefined, pad]);
      }

      return yield* bridge.call("world.setSpawnPoint", [cell, pad]);
    });

  // Map state methods
  const getId: WorldMapShape["getId"] = () =>
    Ref.get(mapIdRef).pipe(Effect.map((id) => id ?? 0));

  const getRoomNumber: WorldMapShape["getRoomNumber"] = () =>
    Ref.get(roomNumberRef).pipe(Effect.map((room) => room ?? 0));

  const getName: WorldMapShape["getName"] = () =>
    Ref.get(mapNameRef).pipe(Effect.map((name) => name ?? ""));

  const setName: WorldMapShape["setName"] = (name) => Ref.set(mapNameRef, name);

  const setId: WorldMapShape["setId"] = (id) => Ref.set(mapIdRef, id);

  const setRoomNumber: WorldMapShape["setRoomNumber"] = (roomNumber) =>
    Ref.set(roomNumberRef, roomNumber);

  const reset: WorldMapShape["reset"] = () =>
    Effect.all([
      mutate(stateRef, clearRuntimeState),
      Ref.set(mapIdRef, null),
      Ref.set(mapNameRef, null),
      Ref.set(roomNumberRef, null),
    ]).pipe(Effect.asVoid);

  const dispose = yield* bridge.onConnection((status) => {
    if (status === "OnConnectionLost") {
      runFork(reset());
    }
  });

  yield* Effect.addFinalizer(() => Effect.sync(dispose));

  // Player state methods
  const registerPlayer: WorldPlayersShape["register"] = (username, entId) =>
    mutate(stateRef, (state) => {
      const key = normalize(username);
      state.playerEntityIds.set(key, entId);
      state.playerNamesByEntityId.set(entId, key);
    }).pipe(Effect.asVoid);

  const unregisterPlayer: WorldPlayersShape["unregister"] = (username) =>
    mutate(stateRef, (state) => {
      const key = normalize(username);
      const entId = state.playerEntityIds.get(key);
      state.playerEntityIds.delete(key);
      if (entId !== undefined) {
        state.playerNamesByEntityId.delete(entId);
      }
    }).pipe(Effect.asVoid);

  const addPlayer: WorldPlayersShape["add"] = (data) =>
    mutate(stateRef, (state) => {
      const key = normalize(data.uoName || data.strUsername);
      state.players.set(key, new Avatar(data));
      state.playerEntityIds.set(key, data.entID);
      state.playerNamesByEntityId.set(data.entID, key);
    }).pipe(Effect.asVoid);

  const removePlayer: WorldPlayersShape["remove"] = (username) =>
    mutate(stateRef, (state) => {
      const key = normalize(username);
      const entId = state.playerEntityIds.get(key);
      state.players.delete(key);
      state.playerEntityIds.delete(key);
      if (entId !== undefined) {
        state.playerNamesByEntityId.delete(entId);
        state.playerAuras.delete(entId);
      }
    }).pipe(Effect.asVoid);

  const setSelf: WorldPlayersShape["setSelf"] = (username) =>
    mutate(stateRef, (state) => {
      state.meUsername = normalize(username);
    }).pipe(Effect.asVoid);

  const getPlayers: WorldPlayersShape["getAll"] = () =>
    mutate(stateRef, (state) => state.players);

  const resolveSelf = (state: RuntimeState): Avatar | undefined => {
    if (!state.meUsername) {
      return undefined;
    }

    return state.players.get(state.meUsername);
  };

  const getSelf: WorldPlayersShape["getSelf"] = () =>
    mutate(stateRef, (state) => {
      const me = resolveSelf(state);
      return me ? Option.some(me) : Option.none();
    });

  const withSelf: WorldPlayersShape["withSelf"] = <A>(f: (self: Avatar) => A) =>
    mutate(stateRef, (state) => {
      const me = resolveSelf(state);
      return me ? Option.some(f(me)) : Option.none();
    });

  const getPlayer: WorldPlayersShape["get"] = (selector) =>
    mutate(stateRef, (state) => {
      return optionFromNullable(getPlayerBySelector(state, selector));
    });

  const getPlayerByName: WorldPlayersShape["getByName"] = (name) =>
    mutate(stateRef, (state) => {
      const player = state.players.find((candidate) =>
        equalsIgnoreCase(candidate.username ?? "", name),
      );
      return player ? Option.some(player) : Option.none();
    });

  const addPlayerAura: WorldPlayersShape["addAura"] = (entId, aura) =>
    mutate(stateRef, (state) => {
      const targetAuras = getTargetAuras(state.playerAuras, entId);
      addAuraToTarget(targetAuras, aura);
    }).pipe(Effect.asVoid);

  const updatePlayerAura: WorldPlayersShape["updateAura"] = (entId, aura) =>
    mutate(stateRef, (state) => {
      const targetAuras = getTargetAuras(state.playerAuras, entId);
      updateAuraOnTarget(targetAuras, aura);
    }).pipe(Effect.asVoid);

  const removePlayerAura: WorldPlayersShape["removeAura"] = (entId, auraName) =>
    mutate(stateRef, (state) => {
      removeAuraFromTarget(state.playerAuras.get(entId), auraName);
    }).pipe(Effect.asVoid);

  const getPlayerAura: WorldPlayersShape["getAura"] = (entId, auraName) =>
    mutate(stateRef, (state) => {
      const aura = state.playerAuras.get(entId)?.get(normalize(auraName));
      return aura ? Option.some(aura) : Option.none();
    });

  const getPlayerAuras: WorldPlayersShape["getAuras"] = (entId) =>
    mutate(stateRef, (state) => {
      return cloneAuras(state.playerAuras.get(entId));
    });

  const clearPlayerAuras: WorldPlayersShape["clearAuras"] = (entId) =>
    mutate(stateRef, (state) => {
      state.playerAuras.delete(entId);
    }).pipe(Effect.asVoid);

  // Monster state methods
  const getMonsters: WorldMonstersShape["getAll"] = () =>
    mutate(stateRef, (state) => state.monsters);

  const addMonster: WorldMonstersShape["add"] = (data) =>
    mutate(stateRef, (state) => {
      state.monsters.set(data.monMapId, new Monster(data));
    }).pipe(Effect.asVoid);

  const getMonster: WorldMonstersShape["get"] = (selector) =>
    mutate(stateRef, (state) => {
      return optionFromNullable(getMonsterBySelector(state, selector));
    });

  const findMonsterByName: WorldMonstersShape["findByName"] = (name, cell) =>
    mutate(stateRef, (state) => {
      const monster = state.monsters.find((candidate) => {
        if (cell !== undefined && !equalsIgnoreCase(candidate.cell, cell)) {
          return false;
        }

        return includesIgnoreCase(candidate.name, name);
      });

      return monster ? Option.some(monster) : Option.none();
    });

  const getAvailableMonsters: WorldMonstersShape["getAvailable"] = () =>
    Effect.gen(function* () {
      const rawIds = yield* bridge.call("world.getAvailableMonsterMapIds");
      const ids = rawIds.filter(
        (id): id is number => Number.isFinite(id) && id > 0,
      );
      const allMonsters = yield* getMonsters();
      const available = new Collection<number, Monster>();
      for (const id of ids) {
        const monster = allMonsters.get(id);
        if (monster !== undefined) {
          available.set(id, monster);
        }
      }

      return available;
    });

  const isMonsterAvailable: WorldMonstersShape["isAvailable"] = (selector) =>
    Effect.gen(function* () {
      const monster = yield* getMonster(selector);
      if (Option.isNone(monster)) {
        return false;
      }

      return yield* bridge.call("world.isMonsterAvailable", [
        monster.value.monMapId,
      ]);
    });

  const addMonsterAura: WorldMonstersShape["addAura"] = (monMapId, aura) =>
    mutate(stateRef, (state) => {
      const targetAuras = getTargetAuras(state.monsterAuras, monMapId);
      addAuraToTarget(targetAuras, aura);
    }).pipe(Effect.asVoid);

  const updateMonsterAura: WorldMonstersShape["updateAura"] = (
    monMapId,
    aura,
  ) =>
    mutate(stateRef, (state) => {
      const targetAuras = getTargetAuras(state.monsterAuras, monMapId);
      updateAuraOnTarget(targetAuras, aura);
    }).pipe(Effect.asVoid);

  const removeMonsterAura: WorldMonstersShape["removeAura"] = (
    monMapId,
    auraName,
  ) =>
    mutate(stateRef, (state) => {
      removeAuraFromTarget(state.monsterAuras.get(monMapId), auraName);
    }).pipe(Effect.asVoid);

  const getMonsterAura: WorldMonstersShape["getAura"] = (monMapId, auraName) =>
    mutate(stateRef, (state) => {
      const aura = state.monsterAuras.get(monMapId)?.get(normalize(auraName));
      return aura ? Option.some(aura) : Option.none();
    });

  const getMonsterAuras: WorldMonstersShape["getAuras"] = (monMapId) =>
    mutate(stateRef, (state) => cloneAuras(state.monsterAuras.get(monMapId)));

  const clearMonsterAuras: WorldMonstersShape["clearAuras"] = (monMapId) =>
    mutate(stateRef, (state) => {
      state.monsterAuras.delete(monMapId);
    }).pipe(Effect.asVoid);

  const playerAuras: WorldPlayersShape["auras"] = {
    getAll: (selector) =>
      Effect.gen(function* () {
        const player = yield* getPlayer(selector);
        if (Option.isNone(player)) {
          return new Collection<string, Aura>();
        }

        return yield* getPlayerAuras(player.value.data.entID);
      }),
    get: (selector, auraName) =>
      Effect.gen(function* () {
        const player = yield* getPlayer(selector);
        if (Option.isNone(player)) {
          return Option.none<Aura>();
        }

        return yield* getPlayerAura(player.value.data.entID, auraName);
      }),
    has: (selector, auraName, options) =>
      Effect.gen(function* () {
        const aura = yield* playerAuras.get(selector, auraName);
        return matchesAura(Option.isSome(aura) ? aura.value : undefined, options);
      }),
  };

  const monsterAuras: WorldMonstersShape["auras"] = {
    getAll: (selector) =>
      Effect.gen(function* () {
        const monster = yield* getMonster(selector);
        if (Option.isNone(monster)) {
          return new Collection<string, Aura>();
        }

        return yield* getMonsterAuras(monster.value.monMapId);
      }),
    get: (selector, auraName) =>
      Effect.gen(function* () {
        const monster = yield* getMonster(selector);
        if (Option.isNone(monster)) {
          return Option.none<Aura>();
        }

        return yield* getMonsterAura(monster.value.monMapId, auraName);
      }),
    has: (selector, auraName, options) =>
      Effect.gen(function* () {
        const aura = yield* monsterAuras.get(selector, auraName);
        return matchesAura(Option.isSome(aura) ? aura.value : undefined, options);
      }),
  };

  const entities: WorldEntitiesShape = {
    getAll: () =>
      mutate(stateRef, (state) => {
        const all = new Collection<WorldEntityKey, WorldEntity>();
        for (const player of state.players.values()) {
          const entity = toPlayerEntity(player);
          all.set(entity.key, entity);
        }

        for (const monster of state.monsters.values()) {
          const entity = toMonsterEntity(monster);
          all.set(entity.key, entity);
        }

        return all;
      }),
    getMe: () =>
      mutate(stateRef, (state) =>
        optionFromNullable(getEntityBySelector(state, { type: "self" })),
      ),
    get: (selector) =>
      mutate(stateRef, (state) =>
        optionFromNullable(getEntityBySelector(state, selector)),
      ),
  };

  const map: WorldMapShape = {
    getCells,
    getCellPads,
    isLoaded,
    getMapItem,
    loadSwf,
    reload,
    setSpawnPoint,
    getName,
    getId,
    getRoomNumber,
    setName,
    setId,
    setRoomNumber,
    reset,
  };

  const players: WorldPlayersShape = {
    register: registerPlayer,
    unregister: unregisterPlayer,
    add: addPlayer,
    remove: removePlayer,
    setSelf,
    getAll: getPlayers,
    getSelf,
    withSelf,
    get: getPlayer,
    getByName: getPlayerByName,
    addAura: addPlayerAura,
    updateAura: updatePlayerAura,
    removeAura: removePlayerAura,
    getAuras: getPlayerAuras,
    getAura: getPlayerAura,
    clearAuras: clearPlayerAuras,
    auras: playerAuras,
  };

  const monsters: WorldMonstersShape = {
    getAll: getMonsters,
    add: addMonster,
    get: getMonster,
    findByName: findMonsterByName,
    getAvailable: getAvailableMonsters,
    isAvailable: isMonsterAvailable,
    addAura: addMonsterAura,
    updateAura: updateMonsterAura,
    removeAura: removeMonsterAura,
    getAuras: getMonsterAuras,
    getAura: getMonsterAura,
    clearAuras: clearMonsterAuras,
    auras: monsterAuras,
  };

  return {
    map,
    players,
    monsters,
    entities,
  } satisfies WorldShape;
});

export const WorldLive = Layer.effect(World, make);
