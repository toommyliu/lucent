import type {
  Aura,
  AuraData,
  AuraKind,
  AuraQueryOptions,
  MonsterData,
  PlayerData,
} from "@lucent/game";
import { LiveAura, LiveMonster, LivePlayer } from "@lucent/game";
import type { MapInfo, Monster, Player } from "../Types";
import type {
  AuraRemovalResult,
  AuraTarget,
  AuraUpsertResult,
  CombatAuraChange,
  CombatStateResult,
  CombatStateUpdate,
  EntityPatchResult,
  MonsterDeathState,
  PlayerDeathState,
} from "./World";

type AuraKey = `${AuraKind}:${string}`;

export interface WorldRuntimeState {
  readonly map: MapInfo;
  readonly monsterAuras: Map<number, Map<AuraKey, LiveAura>>;
  readonly monsters: Map<number, LiveMonster>;
  readonly playerAuras: Map<number, Map<AuraKey, LiveAura>>;
  readonly playerEntityIds: Map<number, string>;
  readonly playerIdsByUsername: Map<string, number>;
  readonly players: Map<string, LivePlayer>;
  selfUsername: string;
}

export const initialWorldState = (): WorldRuntimeState => ({
  map: { id: 0, name: "", roomNumber: 0 },
  monsterAuras: new Map(),
  monsters: new Map(),
  playerAuras: new Map(),
  playerEntityIds: new Map(),
  playerIdsByUsername: new Map(),
  players: new Map(),
  selfUsername: "",
});

export const normalizePlayerKey = (username: string): string =>
  username.trim().toLowerCase();

export const makeAuraKey = (kind: AuraKind, name: string): AuraKey =>
  `${kind}:${name.trim().toLowerCase()}`;

export const resolveAuraKind = (options?: AuraQueryOptions): AuraKind =>
  options?.kind ?? "active";

const cloneAura = (aura: Aura, stack = aura.stack): LiveAura =>
  new LiveAura({
    ...(aura.category === undefined ? {} : { category: aura.category }),
    duration: aura.duration,
    ...(aura.icon === undefined ? {} : { icon: aura.icon }),
    kind: aura.kind,
    name: aura.name,
    stack,
    ...(aura.value === undefined ? {} : { value: aura.value }),
  });

const clonePlayer = (player: Player): LivePlayer =>
  new LivePlayer({
    afk: player.afk,
    cell: player.cell,
    entityId: player.entityId,
    entityType: player.entityType,
    hp: player.hp,
    level: player.level,
    maxHp: player.maxHp,
    maxMp: player.maxMp,
    mp: player.mp,
    name: player.name,
    pad: player.pad,
    position: { ...player.position },
    state: player.state,
    username: player.username,
  });

export const cloneMonster = (monster: Monster): LiveMonster =>
  new LiveMonster({
    cell: monster.cell,
    hp: monster.hp,
    level: monster.level,
    maxHp: monster.maxHp,
    maxMp: monster.maxMp,
    monsterId: monster.monsterId,
    monsterMapId: monster.monsterMapId,
    mp: monster.mp,
    name: monster.name,
    race: monster.race,
    state: monster.state,
  });

export const getPlayerBySelector = (
  state: WorldRuntimeState,
  selector: string | number,
): LivePlayer | null => {
  if (typeof selector === "number") {
    const username = state.playerEntityIds.get(selector);
    return username === undefined
      ? null
      : (state.players.get(username) ?? null);
  }

  return state.players.get(normalizePlayerKey(selector)) ?? null;
};

export const registerPlayerIdentityInState = (
  state: WorldRuntimeState,
  username: string,
  entityId: number,
): void => {
  const key = normalizePlayerKey(username);
  const previousId = state.playerIdsByUsername.get(key);
  if (previousId !== undefined && previousId !== entityId) {
    state.playerEntityIds.delete(previousId);
  }

  const previousUsername = state.playerEntityIds.get(entityId);
  if (previousUsername !== undefined && previousUsername !== key) {
    state.playerIdsByUsername.delete(previousUsername);
  }

  state.playerIdsByUsername.set(key, entityId);
  state.playerEntityIds.set(entityId, key);

  const player = state.players.get(key);
  if (player !== undefined && player.entityId !== entityId) {
    state.playerAuras.delete(player.entityId);
    player.update({ entityId });
  }
};

export const putPlayerInState = (
  state: WorldRuntimeState,
  player: LivePlayer,
): void => {
  const key = normalizePlayerKey(player.username);
  const current = state.players.get(key);
  const previousEntityId = current?.entityId;
  if (current === undefined) state.players.set(key, player);
  else current.replaceFrom(player);
  if (
    previousEntityId !== undefined &&
    previousEntityId !== (current ?? player).entityId
  ) {
    state.playerEntityIds.delete(previousEntityId);
    state.playerAuras.delete(previousEntityId);
  }
  registerPlayerIdentityInState(state, key, (current ?? player).entityId);
  if ((current ?? player).dead) {
    state.playerAuras.delete((current ?? player).entityId);
  }
};

export const putMonsterInState = (
  state: WorldRuntimeState,
  monster: LiveMonster,
): void => {
  const current = state.monsters.get(monster.monsterMapId);
  if (current === undefined) state.monsters.set(monster.monsterMapId, monster);
  else current.replaceFrom(monster);
  if ((current ?? monster).dead) {
    state.monsterAuras.delete((current ?? monster).monsterMapId);
  }
};

export const getAuraSource = (
  state: WorldRuntimeState,
  target: AuraTarget,
): Map<number, Map<AuraKey, LiveAura>> =>
  target === "monster" ? state.monsterAuras : state.playerAuras;

const isLivingAuraTarget = (
  state: WorldRuntimeState,
  target: AuraTarget,
  targetId: number,
): boolean => {
  const entity =
    target === "monster"
      ? state.monsters.get(targetId)
      : getPlayerBySelector(state, targetId);
  return entity === undefined || entity === null || entity.dead === false;
};

const ensureTargetAuras = (
  state: WorldRuntimeState,
  target: AuraTarget,
  targetId: number,
): Map<AuraKey, LiveAura> | null => {
  if (!isLivingAuraTarget(state, target, targetId)) return null;
  const source = getAuraSource(state, target);
  const current = source.get(targetId);
  if (current !== undefined) return current;
  const created = new Map<AuraKey, LiveAura>();
  source.set(targetId, created);
  return created;
};

const auraMetadataPatch = (
  current: LiveAura,
  incoming: Aura,
): Partial<AuraData> => ({
  ...(incoming.category === undefined ? {} : { category: incoming.category }),
  ...(current.duration === incoming.duration
    ? {}
    : { duration: incoming.duration }),
  ...(incoming.icon === undefined ? {} : { icon: incoming.icon }),
  ...(incoming.value === undefined ? {} : { value: incoming.value }),
});

export const addAuraToState = (
  state: WorldRuntimeState,
  target: AuraTarget,
  targetId: number,
  aura: Aura,
): AuraUpsertResult | null => {
  const targetAuras = ensureTargetAuras(state, target, targetId);
  if (targetAuras === null) return null;

  // Active and passive effects can share a display name.
  const key = makeAuraKey(aura.kind, aura.name);
  const current = targetAuras.get(key);
  if (current === undefined) {
    const stored = cloneAura(aura, Math.max(1, Math.trunc(aura.stack)));
    targetAuras.set(key, stored);
    const detached = cloneAura(stored);
    return { aura: detached, remainingStack: detached.stack };
  }

  const nextStack = current.stack + 1;
  current.update({ ...auraMetadataPatch(current, aura), stack: nextStack });
  return { aura: cloneAura(current), remainingStack: nextStack };
};

export const refreshAuraInState = (
  state: WorldRuntimeState,
  target: AuraTarget,
  targetId: number,
  aura: Aura,
): AuraUpsertResult | null => {
  const targetAuras = ensureTargetAuras(state, target, targetId);
  if (targetAuras === null) return null;

  const key = makeAuraKey(aura.kind, aura.name);
  const current = targetAuras.get(key);
  if (current === undefined) {
    const stored = cloneAura(aura, Math.max(1, Math.trunc(aura.stack)));
    targetAuras.set(key, stored);
    const detached = cloneAura(stored);
    return { aura: detached, remainingStack: detached.stack };
  }

  current.update(auraMetadataPatch(current, aura));
  return { aura: cloneAura(current), remainingStack: current.stack };
};

const removeAuraKindFromState = (
  state: WorldRuntimeState,
  target: AuraTarget,
  targetId: number,
  auraName: string,
  kind: AuraKind,
): AuraRemovalResult | null => {
  const source = getAuraSource(state, target);
  const targetAuras = source.get(targetId);
  const key = makeAuraKey(kind, auraName);
  const current = targetAuras?.get(key);
  if (targetAuras === undefined || current === undefined) return null;

  const remainingStack = Math.max(0, current.stack - 1);
  if (remainingStack === 0) targetAuras.delete(key);
  else current.update({ stack: remainingStack });
  if (targetAuras.size === 0) source.delete(targetId);
  return { auraName: current.name, kind, remainingStack };
};

export const removeAurasFromState = (
  state: WorldRuntimeState,
  target: AuraTarget,
  targetId: number,
  auraName: string,
  kind?: AuraKind,
): readonly AuraRemovalResult[] =>
  (kind === undefined ? (["active", "passive"] as const) : [kind]).flatMap(
    (candidateKind) => {
      const result = removeAuraKindFromState(
        state,
        target,
        targetId,
        auraName,
        candidateKind,
      );
      return result === null ? [] : [result];
    },
  );

export const applyPlayerPatch = (
  state: WorldRuntimeState,
  username: string,
  patch: Partial<PlayerData>,
): EntityPatchResult<Player> | null => {
  const key = normalizePlayerKey(username);
  const current = state.players.get(key);
  if (current === undefined) return null;

  const wasDead = current.dead;
  const previousEntityId = current.entityId;
  current.update(patch);
  const nextKey = normalizePlayerKey(current.username);
  if (nextKey !== key) {
    state.players.delete(key);
    state.players.set(nextKey, current);
    if (state.selfUsername === key) state.selfUsername = nextKey;
  }
  if (previousEntityId !== current.entityId) {
    state.playerAuras.delete(previousEntityId);
    state.playerEntityIds.delete(previousEntityId);
  }
  registerPlayerIdentityInState(state, nextKey, current.entityId);
  if (current.dead) state.playerAuras.delete(current.entityId);
  return { becameDead: !wasDead && current.dead, entity: clonePlayer(current) };
};

export const applyMonsterPatch = (
  state: WorldRuntimeState,
  monsterMapId: number,
  patch: Partial<MonsterData>,
): EntityPatchResult<Monster> | null => {
  const current = state.monsters.get(monsterMapId);
  if (current === undefined) return null;

  const wasDead = current.dead;
  current.update(patch);
  if (current.monsterMapId !== monsterMapId) {
    state.monsters.delete(monsterMapId);
    state.monsters.set(current.monsterMapId, current);
    state.monsterAuras.delete(monsterMapId);
  }
  if (current.dead) state.monsterAuras.delete(current.monsterMapId);
  return {
    becameDead: !wasDead && current.dead,
    entity: cloneMonster(current),
  };
};

export const removePlayerFromState = (
  state: WorldRuntimeState,
  username: string,
): Player | null => {
  const key = normalizePlayerKey(username);
  const current = state.players.get(key);
  const entityId = current?.entityId ?? state.playerIdsByUsername.get(key);
  if (entityId !== undefined) {
    state.playerEntityIds.delete(entityId);
    state.playerAuras.delete(entityId);
  }
  state.playerIdsByUsername.delete(key);
  state.players.delete(key);
  if (state.selfUsername === key) state.selfUsername = "";
  return current === undefined ? null : clonePlayer(current);
};

export const removeMonsterFromState = (
  state: WorldRuntimeState,
  monsterMapId: number,
): Monster | null => {
  const current = state.monsters.get(monsterMapId);
  state.monsters.delete(monsterMapId);
  state.monsterAuras.delete(monsterMapId);
  return current === undefined ? null : cloneMonster(current);
};

const playerDeathState = (
  state: WorldRuntimeState,
  player: Player,
): PlayerDeathState => ({
  cell: player.cell,
  entityId: player.entityId,
  hp: player.hp,
  isSelf: state.selfUsername === normalizePlayerKey(player.username),
  pad: player.pad,
  state: player.state,
  username: player.username,
});

export const reduceCombatStateInState = (
  state: WorldRuntimeState,
  update: CombatStateUpdate,
): CombatStateResult => {
  const playerDeaths: PlayerDeathState[] = [];
  const monsterDeaths: MonsterDeathState[] = [];
  const auraChanges: CombatAuraChange[] = [];
  const playerTransitions = new Map<
    string,
    { entity: Player; wasDead: boolean }
  >();
  const monsterTransitions = new Map<
    number,
    { entity: Monster; wasDead: boolean }
  >();

  for (const playerPatch of update.playerPatches) {
    const transitionKey = normalizePlayerKey(playerPatch.username);
    const previous = getPlayerBySelector(state, playerPatch.username);
    const wasDead =
      playerTransitions.get(transitionKey)?.wasDead ?? previous?.dead ?? true;
    const result = applyPlayerPatch(
      state,
      playerPatch.username,
      playerPatch.patch,
    );
    if (result !== null) {
      playerTransitions.set(transitionKey, { entity: result.entity, wasDead });
    }
  }

  for (const monsterPatch of update.monsterPatches) {
    const previous = state.monsters.get(monsterPatch.monsterMapId);
    const wasDead =
      monsterTransitions.get(monsterPatch.monsterMapId)?.wasDead ??
      previous?.dead ??
      true;
    const result = applyMonsterPatch(
      state,
      monsterPatch.monsterMapId,
      monsterPatch.patch,
    );
    if (result !== null) {
      monsterTransitions.set(monsterPatch.monsterMapId, {
        entity: result.entity,
        wasDead,
      });
    }
  }

  for (const { entity, wasDead } of playerTransitions.values()) {
    if (!wasDead && entity.dead) {
      playerDeaths.push(playerDeathState(state, entity));
    }
  }
  for (const { entity, wasDead } of monsterTransitions.values()) {
    if (!wasDead && entity.dead) {
      monsterDeaths.push({ monsterMapId: entity.monsterMapId });
    }
  }

  for (const mutation of update.auraMutations) {
    if (mutation.operation === "remove") {
      const [result] = removeAurasFromState(
        state,
        mutation.targetType,
        mutation.targetId,
        mutation.auraName,
        mutation.kind,
      );
      if (result !== undefined) {
        auraChanges.push({
          ...result,
          operation: "removed",
          targetId: mutation.targetId,
          targetType: mutation.targetType,
        });
      }
      continue;
    }

    const result =
      mutation.operation === "add"
        ? addAuraToState(
            state,
            mutation.targetType,
            mutation.targetId,
            mutation.aura,
          )
        : refreshAuraInState(
            state,
            mutation.targetType,
            mutation.targetId,
            mutation.aura,
          );
    if (result !== null) {
      auraChanges.push({
        aura: result.aura,
        kind: result.aura.kind,
        operation: mutation.operation === "add" ? "added" : "refreshed",
        targetId: mutation.targetId,
        targetType: mutation.targetType,
      });
    }
  }

  for (const player of state.players.values()) {
    if (player.dead) state.playerAuras.delete(player.entityId);
  }
  for (const monster of state.monsters.values()) {
    if (monster.dead) state.monsterAuras.delete(monster.monsterMapId);
  }

  return { auraChanges, monsterDeaths, playerDeaths };
};
