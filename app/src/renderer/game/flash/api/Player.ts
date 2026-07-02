import { Context, Effect, Layer, Random } from "effect";

import type {
  AuraRecord,
  FactionRecord,
  ItemSelector,
  OutfitOptions,
  OutfitRecord,
  PlayerRecord,
  Position,
} from "../Types";
import { SwfBridge } from "../SwfBridge";
import { asInt, asRecord, asString, equalsIgnoreCase } from "../payload";
import { AuthApi } from "./Auth";
import { InventoryApi } from "./Inventory";
import { MapApi } from "./Map";
import { PlayersApi } from "./Players";
import { WaitApi } from "./Wait";
import { WorldState } from "../state/World";

export interface FactionsApi {
  readonly get: (
    selector: string | number,
  ) => Effect.Effect<FactionRecord | null>;
  readonly getAll: () => Effect.Effect<readonly FactionRecord[]>;
}

export interface OutfitsApi {
  readonly equip: (
    name: string,
    options?: OutfitOptions,
  ) => Effect.Effect<boolean>;
  readonly get: (name: string) => Effect.Effect<OutfitRecord | null>;
  readonly getAll: () => Effect.Effect<readonly OutfitRecord[]>;
  readonly wear: (
    name: string,
    options?: OutfitOptions,
  ) => Effect.Effect<boolean>;
}

export interface SelfAurasApi {
  readonly get: (auraName: string) => Effect.Effect<AuraRecord | null>;
  readonly getAll: () => Effect.Effect<readonly AuraRecord[]>;
  readonly has: (auraName: string) => Effect.Effect<boolean>;
}

export interface PlayerApiShape {
  readonly auras: SelfAurasApi;
  readonly factions: FactionsApi;
  readonly getCell: () => Effect.Effect<string>;
  readonly getClassName: () => Effect.Effect<string>;
  readonly getGender: () => Effect.Effect<string>;
  readonly getGold: () => Effect.Effect<number>;
  readonly getHp: () => Effect.Effect<number>;
  readonly getLevel: () => Effect.Effect<number>;
  readonly getMaxHp: () => Effect.Effect<number>;
  readonly getMaxMp: () => Effect.Effect<number>;
  readonly getMp: () => Effect.Effect<number>;
  readonly getPad: () => Effect.Effect<string>;
  readonly getPosition: () => Effect.Effect<Position>;
  readonly getState: () => Effect.Effect<number>;
  readonly goToPlayer: (name: string) => Effect.Effect<void>;
  readonly hasActiveBoost: (boostType: string) => Effect.Effect<boolean>;
  readonly isAfk: () => Effect.Effect<boolean>;
  readonly isAlive: () => Effect.Effect<boolean>;
  readonly isMember: () => Effect.Effect<boolean>;
  readonly isReady: () => Effect.Effect<boolean>;
  readonly joinMap: (
    map: string,
    cell?: string,
    pad?: string,
  ) => Effect.Effect<boolean>;
  readonly jumpToCell: (
    cell: string,
    pad?: string,
    correction?: boolean,
  ) => Effect.Effect<void>;
  readonly outfits: OutfitsApi;
  readonly rest: (full?: boolean) => Effect.Effect<void>;
  readonly useBoost: (selector: ItemSelector) => Effect.Effect<boolean>;
  readonly walkTo: (
    x: number,
    y: number,
    walkSpeed?: number,
  ) => Effect.Effect<boolean>;
}

export class PlayerApi extends Context.Service<PlayerApi, PlayerApiShape>()(
  "lucent/game/flash/api/Player",
) {}

const defaultPlayer: PlayerRecord = {
  afk: false,
  cell: "",
  entityId: 0,
  entityType: "player",
  hp: 0,
  level: 0,
  maxHp: 0,
  maxMp: 0,
  mp: 0,
  name: "",
  pad: "",
  position: [0, 0],
  state: 0,
  username: "",
};

const playerIsAlive = (player: PlayerRecord): boolean =>
  player.hp > 0 && player.state !== 0;

const normalizeFaction = (value: unknown): FactionRecord | null => {
  const record = asRecord(value);
  if (record === null) {
    return null;
  }

  const id = asInt(record["FactionID"] ?? record["id"]);
  const name = asString(record["sName"] ?? record["name"]);
  if (id === undefined || name === undefined) {
    return null;
  }

  return {
    id,
    name,
    rank: asInt(record["iRank"]) ?? 0,
    reputation: asInt(record["iRep"]) ?? 0,
  };
};

const normalizeOutfit = (value: unknown): OutfitRecord | null => {
  const record = asRecord(value);
  const name = asString(record?.["sName"] ?? record?.["name"]);
  return record === null || name === undefined ? null : { name, raw: record };
};

const minRoomNumber = 1;
const minDirectRoomNumber = 1_000;
const maxRoomNumber = 99_999;

interface MapTarget {
  readonly map: string;
  readonly name: string;
  readonly requireExactRoom: boolean;
  readonly roomNumber?: number;
}

const parseRoomNumber = (roomToken: string): number | null => {
  if (!/^\d+$/.test(roomToken)) {
    return null;
  }

  const roomNumber = Number(roomToken);
  return Number.isSafeInteger(roomNumber) &&
    roomNumber >= minRoomNumber &&
    roomNumber <= maxRoomNumber
    ? roomNumber
    : null;
};

const parseMapTarget = (map: string): Effect.Effect<MapTarget> =>
  Effect.gen(function* () {
    const trimmed = map.trim();
    const separatorIndex = trimmed.indexOf("-");
    if (separatorIndex <= 0) {
      return {
        map: trimmed,
        name: trimmed,
        requireExactRoom: false,
      };
    }

    const name = trimmed.slice(0, separatorIndex);
    const roomToken = trimmed.slice(separatorIndex + 1);
    const parsedRoomNumber = parseRoomNumber(roomToken);
    const roomNumber =
      parsedRoomNumber ??
      (yield* Random.nextIntBetween(minDirectRoomNumber, maxRoomNumber));

    return {
      map: `${name}-${roomNumber}`,
      name,
      requireExactRoom: roomNumber >= minDirectRoomNumber,
      roomNumber,
    };
  });

export const layer = Layer.effect(
  PlayerApi,
  Effect.gen(function* () {
    const auth = yield* AuthApi;
    const bridge = yield* SwfBridge;
    const inventory = yield* InventoryApi;
    const map = yield* MapApi;
    const players = yield* PlayersApi;
    const wait = yield* WaitApi;
    const world = yield* WorldState;

    const self = world
      .getMe()
      .pipe(Effect.map((player) => player ?? defaultPlayer));
    const project = <A>(f: (player: PlayerRecord) => A) =>
      self.pipe(Effect.map(f));

    const auras: SelfAurasApi = {
      get: (auraName) =>
        Effect.gen(function* () {
          const player = yield* self;
          if (player.entityId === 0) {
            return null;
          }

          return yield* players.auras.get(player.entityId, auraName);
        }),
      getAll: () =>
        Effect.gen(function* () {
          const player = yield* self;
          if (player.entityId === 0) {
            return [];
          }

          return yield* world.getPlayerAuras(player.entityId);
        }),
      has: (auraName) =>
        auras.get(auraName).pipe(Effect.map((aura) => aura !== null)),
    };

    const getFactions = bridge
      .call("player.getFactions")
      .pipe(
        Effect.map((raw) =>
          Array.isArray(raw)
            ? raw
                .map(normalizeFaction)
                .filter((faction): faction is FactionRecord => faction !== null)
            : [],
        ),
      );

    const factions: FactionsApi = {
      get: (selector) =>
        getFactions.pipe(
          Effect.map(
            (factions) =>
              factions.find((faction) =>
                typeof selector === "number"
                  ? faction.id === selector
                  : equalsIgnoreCase(faction.name, selector),
              ) ?? null,
          ),
        ),
      getAll: () => getFactions,
    };

    const getOutfits = bridge
      .call("outfits.getAll")
      .pipe(
        Effect.map((raw) =>
          Array.isArray(raw)
            ? raw
                .map(normalizeOutfit)
                .filter((outfit): outfit is OutfitRecord => outfit !== null)
            : [],
        ),
      );

    const outfits: OutfitsApi = {
      equip: (name, options) =>
        wait
          .forGameAction("equipLoadout")
          .pipe(
            Effect.flatMap((ready) =>
              ready
                ? bridge.call("outfits.equip", [name, options?.keepColors])
                : Effect.succeed(false),
            ),
          ),
      get: (name) =>
        getOutfits.pipe(
          Effect.map(
            (outfits) =>
              outfits.find((outfit) => equalsIgnoreCase(outfit.name, name)) ??
              null,
          ),
        ),
      getAll: () => getOutfits,
      wear: (name, options) =>
        wait
          .forGameAction("wearLoadout")
          .pipe(
            Effect.flatMap((ready) =>
              ready
                ? bridge.call("outfits.wear", [name, options?.keepColors])
                : Effect.succeed(false),
            ),
          ),
    };

    const isAlive = Effect.gen(function* () {
      const player = yield* world.getMe();
      if (player !== null && playerIsAlive(player)) {
        return true;
      }

      const [hp, state] = yield* Effect.all([
        bridge.call("player.getHp"),
        bridge.call("player.getState"),
      ]);
      return hp > 0 && state !== 0;
    });

    const jumpToCell: PlayerApiShape["jumpToCell"] = (
      cell,
      pad,
      correction = true,
    ) =>
      Effect.gen(function* () {
        const targetCell = cell.trim();
        if (targetCell === "") {
          return;
        }

        if (pad === undefined) {
          yield* bridge.call("player.jump", [targetCell]);
        } else {
          yield* bridge.call("player.jump", [targetCell, pad]);
        }

        if (correction) {
          yield* wait.until(
            project((player) => equalsIgnoreCase(player.cell, targetCell)),
            { timeout: "3 seconds" },
          );
        }
      });

    const joinMap: PlayerApiShape["joinMap"] = (target, cell, pad) =>
      Effect.gen(function* () {
        const parsed = yield* parseMapTarget(target);
        if (parsed.map === "") {
          return false;
        }

        const canTransfer = yield* wait.forGameAction("tfer", {
          timeout: "10 seconds",
        });
        if (!canTransfer) {
          return false;
        }

        if (cell === undefined && pad === undefined) {
          yield* bridge.call("player.joinMap", [parsed.map]);
        } else if (pad === undefined) {
          yield* bridge.call("player.joinMap", [parsed.map, cell ?? "Enter"]);
        } else {
          yield* bridge.call("player.joinMap", [
            parsed.map,
            cell ?? "Enter",
            pad,
          ]);
        }

        const loaded = yield* wait.until(
          Effect.gen(function* () {
            const current = yield* map.getName();
            if (!equalsIgnoreCase(current, parsed.name)) {
              return false;
            }

            if (!parsed.requireExactRoom || parsed.roomNumber === undefined) {
              return true;
            }

            return (yield* map.getRoomNumber()) === parsed.roomNumber;
          }),
          { timeout: "10 seconds" },
        );
        if (!loaded) {
          return false;
        }

        if (cell !== undefined) {
          yield* jumpToCell(cell, pad, true);
        }
        return true;
      });

    return PlayerApi.of({
      auras,
      factions,
      getCell: () => project((player) => player.cell),
      getClassName: () => bridge.call("player.getClassName"),
      getGender: () => bridge.call("player.getGender"),
      getGold: () => bridge.call("player.getGold"),
      getHp: () => project((player) => player.hp),
      getLevel: () => project((player) => player.level),
      getMaxHp: () => project((player) => player.maxHp),
      getMaxMp: () => project((player) => player.maxMp),
      getMp: () => project((player) => player.mp),
      getPad: () => project((player) => player.pad),
      getPosition: () =>
        project((player) => ({
          x: player.position[0],
          y: player.position[1],
        })),
      getState: () => project((player) => player.state),
      goToPlayer: (name) =>
        name.trim() === ""
          ? Effect.void
          : bridge.call("player.goToPlayer", [name.trim()]),
      hasActiveBoost: (boostType) =>
        bridge.call("player.hasActiveBoost", [boostType]),
      isAfk: () => project((player) => player.afk),
      isAlive: () => isAlive,
      isMember: () => bridge.call("player.isMember"),
      isReady: () =>
        Effect.gen(function* () {
          return (
            (yield* auth.isLoggedIn()) &&
            (yield* map.isLoaded()) &&
            (yield* bridge.call("player.isLoaded"))
          );
        }),
      joinMap,
      jumpToCell,
      outfits,
      rest: (full = false) =>
        Effect.gen(function* () {
          const canRest = yield* wait.forGameAction("rest");
          if (!canRest) {
            return;
          }

          const player = yield* self;
          if (player.hp >= player.maxHp && player.mp >= player.maxMp) {
            return;
          }

          yield* bridge.call("player.rest");
          if (full) {
            yield* wait.until(
              self.pipe(
                Effect.map(
                  (current) =>
                    current.hp >= current.maxHp && current.mp >= current.maxMp,
                ),
              ),
              { timeout: "10 seconds" },
            );
          }
        }),
      useBoost: (selector) =>
        Effect.gen(function* () {
          const item = yield* inventory.get(selector);
          return item === null
            ? false
            : yield* bridge.call("player.useBoost", [item.itemId]);
        }),
      walkTo: (x, y, walkSpeed) =>
        Effect.gen(function* () {
          if (!(yield* isAlive)) {
            return false;
          }

          const targetX = Math.trunc(x);
          const targetY = Math.trunc(y);
          const started =
            walkSpeed === undefined
              ? yield* bridge.call("player.walkTo", [targetX, targetY])
              : yield* bridge.call("player.walkTo", [
                  targetX,
                  targetY,
                  walkSpeed,
                ]);
          if (!started) {
            return false;
          }

          yield* wait.forPacket({
            command: "mv",
            direction: "client",
            wireType: "str",
          });

          const settled = yield* wait.until(
            Effect.gen(function* () {
              const projected = yield* world.getMe();
              if (projected !== null) {
                return (
                  projected.position[0] === targetX &&
                  projected.position[1] === targetY
                );
              }

              const position = yield* bridge.call("player.getPosition");
              const parts = Array.isArray(position) ? position : [];
              const currentX = asInt(parts[0]);
              const currentY = asInt(parts[1]);
              return currentX === targetX && currentY === targetY;
            }),
            { timeout: "3 seconds" },
          );
          return settled;
        }),
    });
  }),
);
