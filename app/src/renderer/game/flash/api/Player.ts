import { Context, Effect, Layer } from "effect";

import type {
  Aura,
  EntityState as EntityStateValue,
  Faction,
  ItemSelector,
  OutfitOptions,
  Outfit,
  Player,
  Position,
} from "../Types";
import {
  EntityState,
  LiveFaction,
  LivePlayer,
  type LiveOutfit,
} from "@lucent/game";
import { SwfBridge } from "../SwfBridge";
import { parseMapTarget } from "../MapTarget";
import type { MapTarget } from "../MapTarget";
import {
  asInt,
  asRecord,
  asString,
  decodeOutfitModel,
  equalsIgnoreCase,
} from "../payload";
import { AuthApi } from "./Auth";
import { InventoryApi } from "./Inventory";
import { MapApi } from "./Map";
import { PlayersApi } from "./Players";
import { WaitApi } from "./Wait";
import { WorldState } from "../state/World";

export interface FactionsApi {
  readonly get: (selector: string | number) => Effect.Effect<Faction | null>;
  readonly getAll: () => Effect.Effect<readonly Faction[]>;
}

export interface OutfitsApi {
  readonly equip: (
    name: string,
    options?: OutfitOptions,
  ) => Effect.Effect<boolean>;
  readonly get: (name: string) => Effect.Effect<Outfit | null>;
  readonly getAll: () => Effect.Effect<readonly Outfit[]>;
  readonly wear: (
    name: string,
    options?: OutfitOptions,
  ) => Effect.Effect<boolean>;
}

export interface SelfAurasApi {
  readonly get: (auraName: string) => Effect.Effect<Aura | null>;
  readonly getAll: () => Effect.Effect<readonly Aura[]>;
  readonly has: (auraName: string) => Effect.Effect<boolean>;
}

export interface PlayerApiShape {
  readonly auras: SelfAurasApi;
  readonly factions: FactionsApi;
  readonly get: () => Effect.Effect<Player | null>;
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
  readonly getState: () => Effect.Effect<EntityStateValue>;
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

const defaultPlayer = new LivePlayer({
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
  position: { x: 0, y: 0 },
  state: EntityState.Dead,
  username: "",
});

const normalizeFaction = (value: unknown): LiveFaction | null => {
  const record = asRecord(value);
  if (record === null) {
    return null;
  }

  const id = asInt(record["FactionID"]);
  const name = asString(record["sName"]);
  if (id === undefined || name === undefined) {
    return null;
  }

  return new LiveFaction({
    id,
    name,
    rank: asInt(record["iRank"]) ?? 0,
    reputation: asInt(record["iRep"]) ?? 0,
  });
};

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
    const factionCache = new Map<number, LiveFaction>();
    const outfitCache = new Map<string, LiveOutfit>();

    const self = world
      .getMe()
      .pipe(Effect.map((player) => player ?? defaultPlayer));
    const project = <A>(f: (player: Player) => A) => self.pipe(Effect.map(f));
    const getCell = () => project((player) => player.cell);
    const getPad = () => project((player) => player.pad);

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

    const getFactions = bridge.call("player.getFactions").pipe(
      Effect.map((raw) => {
        const decoded = Array.isArray(raw)
          ? raw
              .map(normalizeFaction)
              .filter((faction): faction is LiveFaction => faction !== null)
          : [];
        const ids = new Set(decoded.map((faction) => faction.id));
        for (const id of factionCache.keys())
          if (!ids.has(id)) factionCache.delete(id);
        for (const faction of decoded) {
          const current = factionCache.get(faction.id);
          if (current === undefined) factionCache.set(faction.id, faction);
          else current.replaceFrom(faction);
        }
        return Array.from(factionCache.values());
      }),
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

    const getOutfits = bridge.call("outfits.getAll").pipe(
      Effect.map((raw) => {
        const decoded = Array.isArray(raw)
          ? raw
              .map(decodeOutfitModel)
              .filter((outfit): outfit is LiveOutfit => outfit !== null)
          : [];
        const keys = new Set(
          decoded.map((outfit) => outfit.name.toLowerCase()),
        );
        for (const key of outfitCache.keys())
          if (!keys.has(key)) outfitCache.delete(key);
        for (const outfit of decoded) {
          const key = outfit.name.toLowerCase();
          const current = outfitCache.get(key);
          if (current === undefined) outfitCache.set(key, outfit);
          else current.replaceFrom(outfit);
        }
        return Array.from(outfitCache.values());
      }),
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
      if (player?.alive === true) {
        return true;
      }

      const [hp, state] = yield* Effect.all([
        bridge.call("player.getHp"),
        bridge.call("player.getState"),
      ]);
      return hp > 0 && state !== EntityState.Dead;
    });

    const isReady = Effect.gen(function* () {
      return (
        (yield* auth.isLoggedIn()) &&
        (yield* map.isLoaded()) &&
        (yield* bridge.call("player.isLoaded"))
      );
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

    const isTargetMapLoaded = (targetMap: MapTarget) =>
      Effect.gen(function* () {
        if (!(yield* map.isLoaded())) {
          return false;
        }

        const current = yield* map.getName();
        if (!equalsIgnoreCase(current, targetMap.name)) {
          return false;
        }

        if (
          targetMap.requireExactRoom &&
          targetMap.roomNumber !== undefined &&
          (yield* map.getRoomNumber()) !== targetMap.roomNumber
        ) {
          return false;
        }

        return yield* bridge.call("player.isLoaded");
      });

    const isAtLocation = (
      targetCell: string | undefined,
      targetPad: string | undefined,
    ) =>
      Effect.gen(function* () {
        if (
          targetCell !== undefined &&
          !equalsIgnoreCase(yield* getCell(), targetCell)
        ) {
          return false;
        }

        if (
          targetPad !== undefined &&
          !equalsIgnoreCase(yield* getPad(), targetPad)
        ) {
          return false;
        }

        return true;
      });

    const targetCellExists = (targetCell: string) =>
      map
        .getCells()
        .pipe(
          Effect.map((cells) =>
            cells.some((cell) => equalsIgnoreCase(cell, targetCell)),
          ),
        );

    const correctJoinLocation = (
      targetCell: string | undefined,
      targetPad: string | undefined,
      options?: { readonly force?: boolean },
    ) =>
      Effect.gen(function* () {
        if (targetCell === undefined) {
          return;
        }

        if (
          options?.force !== true &&
          (yield* isAtLocation(targetCell, targetPad))
        ) {
          return;
        }

        if (!(yield* targetCellExists(targetCell))) {
          return;
        }

        yield* jumpToCell(targetCell, targetPad, true);
      });

    const joinMap: PlayerApiShape["joinMap"] = (target, cell, pad) =>
      Effect.gen(function* () {
        const parsed = yield* parseMapTarget(target);
        if (parsed.map === "") {
          return false;
        }

        const targetCell = cell ?? (pad !== undefined ? "Enter" : undefined);
        if (yield* isTargetMapLoaded(parsed)) {
          yield* correctJoinLocation(targetCell, pad, { force: true });
          return true;
        }

        const ready = yield* wait.until(isReady, { timeout: "10 seconds" });
        if (!ready) {
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

        const loaded = yield* wait.until(isTargetMapLoaded(parsed), {
          timeout: "20 seconds",
        });
        if (!loaded) {
          return false;
        }

        yield* correctJoinLocation(targetCell, pad);
        return true;
      });

    return PlayerApi.of({
      auras,
      factions,
      get: world.getMe,
      getCell,
      getClassName: () => bridge.call("player.getClassName"),
      getGender: () => bridge.call("player.getGender"),
      getGold: () => bridge.call("player.getGold"),
      getHp: () => project((player) => player.hp),
      getLevel: () => project((player) => player.level),
      getMaxHp: () => project((player) => player.maxHp),
      getMaxMp: () => project((player) => player.maxMp),
      getMp: () => project((player) => player.mp),
      getPad,
      getPosition: () => project((player) => player.position),
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
      isReady: () => isReady,
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
                  projected.position.x === targetX &&
                  projected.position.y === targetY
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
