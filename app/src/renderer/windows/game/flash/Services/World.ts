import type {
  Aura,
  Avatar,
  AvatarData,
  Monster,
  MonsterData,
} from "@lucent/game";
import type { Collection } from "@lucent/collection";
import { ServiceMap } from "effect";
import type { Effect, Option } from "effect";
import type { BridgeEffect } from "./Bridge";

export interface PlayerSelectorObject {
  readonly username?: string;
  readonly entId?: number;
}

export type PlayerSelector = string | number | PlayerSelectorObject;

export interface MonsterSelectorObject {
  readonly monMapId?: number;
  readonly name?: string;
}

export type MonsterSelector = MonsterIdentifierToken | MonsterSelectorObject;

export type WorldEntityKey = `player:${number}` | `monster:${number}`;

export type WorldEntity =
  | {
      readonly type: "player";
      readonly key: WorldEntityKey;
      readonly entId: number;
      readonly username: string;
      readonly entity: Avatar;
    }
  | {
      readonly type: "monster";
      readonly key: WorldEntityKey;
      readonly monMapId: number;
      readonly name: string;
      readonly entity: Monster;
    };

export type WorldEntitySelector =
  | { readonly type: "self" }
  | ({ readonly type: "player" } & PlayerSelectorObject)
  | ({ readonly type: "monster" } & MonsterSelectorObject);

export interface WorldPlayerAurasShape {
  getAll(player: PlayerSelector): Effect.Effect<Collection<string, Aura>>;
  get(
    player: PlayerSelector,
    auraName: string,
  ): Effect.Effect<Option.Option<Aura>>;
  has(
    player: PlayerSelector,
    auraName: string,
    minStacks?: number,
  ): Effect.Effect<boolean>;
}

export interface WorldMonsterAurasShape {
  getAll(monster: MonsterSelector): Effect.Effect<Collection<string, Aura>>;
  get(
    monster: MonsterSelector,
    auraName: string,
  ): Effect.Effect<Option.Option<Aura>>;
  has(
    monster: MonsterSelector,
    auraName: string,
    minStacks?: number,
  ): Effect.Effect<boolean>;
}

export interface WorldEntitiesShape {
  getAll(): Effect.Effect<Collection<WorldEntityKey, WorldEntity>>;
  getMe(): Effect.Effect<Option.Option<WorldEntity>>;
  get(selector: WorldEntitySelector): Effect.Effect<Option.Option<WorldEntity>>;
}

export interface WorldMapShape {
  // Bridge methods
  getCells(): BridgeEffect<string[]>;
  getCellPads(): BridgeEffect<string[]>;
  isLoaded(): BridgeEffect<boolean>;
  getMapItem(itemId: number): BridgeEffect<void>;
  loadSwf(path: string): BridgeEffect<void>;
  reload(): BridgeEffect<void>;
  setSpawnPoint(cell?: string, pad?: string): BridgeEffect<void>;

  // State methods
  getName(): Effect.Effect<string>;
  getId(): Effect.Effect<number>;
  getRoomNumber(): Effect.Effect<number>;
  setName(name: string): Effect.Effect<void>;
  setId(id: number): Effect.Effect<void>;
  setRoomNumber(roomNumber: number): Effect.Effect<void>;
  reset(): Effect.Effect<void>;
}

export interface WorldPlayersShape {
  register(username: string, entId: number): Effect.Effect<void>;
  unregister(username: string): Effect.Effect<void>;
  add(data: AvatarData): Effect.Effect<void>;
  remove(username: string): Effect.Effect<void>;
  setSelf(username: string): Effect.Effect<void>;
  getAll(): Effect.Effect<Collection<string, Avatar>>;
  getSelf(): Effect.Effect<Option.Option<Avatar>>;
  withSelf<A>(f: (self: Avatar) => A): Effect.Effect<Option.Option<A>>;
  get(selector: PlayerSelector): Effect.Effect<Option.Option<Avatar>>;
  getByName(name: string): Effect.Effect<Option.Option<Avatar>>;
  addAura(entId: number, aura: Aura): Effect.Effect<void>;
  updateAura(entId: number, aura: Aura): Effect.Effect<void>;
  removeAura(entId: number, auraName: string): Effect.Effect<void>;
  getAuras(entId: number): Effect.Effect<Collection<string, Aura>>;
  getAura(entId: number, auraName: string): Effect.Effect<Option.Option<Aura>>;
  clearAuras(entId: number): Effect.Effect<void>;
  readonly auras: WorldPlayerAurasShape;
}

export interface WorldMonstersShape {
  getAll(): Effect.Effect<Collection<number, Monster>>;
  add(data: MonsterData): Effect.Effect<void>;
  get(selector: MonsterSelector): Effect.Effect<Option.Option<Monster>>;
  findByName(
    name: string,
    cell?: string,
  ): Effect.Effect<Option.Option<Monster>>;
  getAvailable(): BridgeEffect<Collection<number, Monster>>;
  isAvailable(monster: MonsterSelector): BridgeEffect<boolean>;
  addAura(monMapId: number, aura: Aura): Effect.Effect<void>;
  updateAura(monMapId: number, aura: Aura): Effect.Effect<void>;
  removeAura(monMapId: number, auraName: string): Effect.Effect<void>;
  getAuras(monMapId: number): Effect.Effect<Collection<string, Aura>>;
  getAura(
    monMapId: number,
    auraName: string,
  ): Effect.Effect<Option.Option<Aura>>;
  clearAuras(monMapId: number): Effect.Effect<void>;
  readonly auras: WorldMonsterAurasShape;
}

export interface WorldShape {
  map: WorldMapShape;
  players: WorldPlayersShape;
  monsters: WorldMonstersShape;
  entities: WorldEntitiesShape;
}

export class World extends ServiceMap.Service<World, WorldShape>()(
  "flash/Services/World",
) {}
