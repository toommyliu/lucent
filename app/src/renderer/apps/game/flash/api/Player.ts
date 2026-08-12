import { EntityState, LiveFaction, LiveOutfit } from "@lucent/game";
import type { BoostType, ItemQuery, LiveItem } from "@lucent/game";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { BridgeService } from "../bridge/Bridge";
import {
  NonNegativeWireInt,
  PositiveWireInt,
  WireInt,
} from "../contract/Coercion";
import { parseMapTarget } from "../domain/MapTarget";
import type { Store } from "../state/Store";
import type { Auth } from "./Auth";
import type { Inventory } from "./Inventory";
import type { Map } from "./Map";
import type { Wait } from "./Wait";

const FactionPayload = Schema.Struct({
  FactionID: PositiveWireInt,
  iRank: Schema.optionalKey(WireInt),
  iRep: Schema.optionalKey(WireInt),
  sName: Schema.String,
});
const FactionPayloads = Schema.Array(FactionPayload);
const OutfitPayload = Schema.Struct({
  None: Schema.optionalKey(NonNegativeWireInt),
  Weapon: Schema.optionalKey(NonNegativeWireInt),
  ar: Schema.optionalKey(NonNegativeWireInt),
  ba: Schema.optionalKey(NonNegativeWireInt),
  co: Schema.optionalKey(NonNegativeWireInt),
  colors: Schema.optionalKey(
    Schema.Struct({
      accessory: Schema.optionalKey(WireInt),
      base: Schema.optionalKey(WireInt),
      eye: Schema.optionalKey(WireInt),
      hair: Schema.optionalKey(WireInt),
      skin: Schema.optionalKey(WireInt),
      trim: Schema.optionalKey(WireInt),
    }),
  ),
  he: Schema.optionalKey(NonNegativeWireInt),
  mi: Schema.optionalKey(NonNegativeWireInt),
  name: Schema.String,
  pe: Schema.optionalKey(NonNegativeWireInt),
});
const OutfitPayloads = Schema.Array(OutfitPayload);

const sameText = (left: string, right: string): boolean =>
  left.localeCompare(right, undefined, { sensitivity: "accent" }) === 0;

const findClassItem = (
  items: readonly LiveItem[],
  query?: ItemQuery,
): LiveItem | undefined =>
  items.find(
    (item) =>
      item.classItem &&
      (query === undefined ? item.equipped : item.matches(query)),
  );

const toFaction = (payload: typeof FactionPayload.Type): LiveFaction =>
  new LiveFaction({
    id: payload.FactionID,
    name: payload.sName,
    rank: payload.iRank ?? 0,
    reputation: payload.iRep ?? 0,
  });

const equippedItemId = (value: number | undefined): number | undefined =>
  value === undefined || value === 0 ? undefined : value;

const toOutfit = (payload: typeof OutfitPayload.Type): LiveOutfit =>
  new LiveOutfit({
    colors: {
      accessory: payload.colors?.accessory,
      base: payload.colors?.base,
      eye: payload.colors?.eye,
      hair: payload.colors?.hair,
      skin: payload.colors?.skin,
      trim: payload.colors?.trim,
    },
    equipment: {
      armorItemId: equippedItemId(payload.co),
      capeItemId: equippedItemId(payload.ba),
      classItemId: equippedItemId(payload.ar),
      helmItemId: equippedItemId(payload.he),
      itemId: equippedItemId(payload.None),
      miscItemId: equippedItemId(payload.mi),
      petItemId: equippedItemId(payload.pe),
      weaponItemId: equippedItemId(payload.Weapon),
    },
    name: payload.name,
  });

export const makePlayer = (
  bridge: BridgeService,
  store: Store,
  auth: Auth,
  inventory: Inventory,
  map: Map,
  wait: Wait,
) => {
  const read = <A>(
    method: keyof Window["swf"],
    schema: Schema.Decoder<A>,
    fallback: A,
  ) =>
    bridge
      .invoke(method, undefined, schema)
      .pipe(Effect.map(Option.getOrElse(() => fallback)));
  const get = () => store.world.getMe;
  const readLocation = (
    projected: string,
    method: "player.getCell" | "player.getPad",
  ) =>
    projected !== ""
      ? Effect.succeed(projected)
      : map
          .isLoaded()
          .pipe(
            Effect.flatMap((loaded) =>
              loaded ? read(method, Schema.String, "") : Effect.succeed(""),
            ),
          );
  const getAuras = (options?: { kind?: "active" | "passive" }) =>
    get().pipe(
      Effect.flatMap((player) =>
        player === null
          ? Effect.succeed([])
          : store.world.getPlayerAuras(player.entityId, options),
      ),
    );

  const factionCache = new Map<number, LiveFaction>();
  const outfitCache = new Map<string, LiveOutfit>();

  const getAura = (name: string, options?: { kind?: "active" | "passive" }) =>
    getAuras(options).pipe(
      Effect.map(
        (auras) => auras.find((aura) => sameText(aura.name, name)) ?? null,
      ),
    );
  const hasAura = (name: string, options?: { kind?: "active" | "passive" }) =>
    getAura(name, options).pipe(Effect.map((aura) => aura !== null));
  const auras = { get: getAura, getAll: getAuras, has: hasAura };

  const getFactions = () =>
    bridge.invoke("player.getFactions", undefined, FactionPayloads).pipe(
      Effect.map(
        Option.match({
          onNone: () => Array.from(factionCache.values()),
          onSome: (payloads) => {
            const incoming = payloads.map(toFaction);
            const ids = new Set(incoming.map((faction) => faction.id));
            for (const id of factionCache.keys()) {
              if (!ids.has(id)) factionCache.delete(id);
            }
            for (const faction of incoming) {
              const current = factionCache.get(faction.id);
              if (current !== undefined) current.replaceFrom(faction);
              else factionCache.set(faction.id, faction);
            }
            return Array.from(factionCache.values());
          },
        }),
      ),
    );
  const getFaction = (selector: string | number) =>
    getFactions().pipe(
      Effect.map(
        (factions) =>
          factions.find((faction) =>
            typeof selector === "number"
              ? faction.id === selector
              : sameText(faction.name, selector),
          ) ?? null,
      ),
    );
  const factions = { get: getFaction, getAll: getFactions };

  const getOutfits = () =>
    bridge.invoke("outfits.getAll", undefined, OutfitPayloads).pipe(
      Effect.map(
        Option.match({
          onNone: () => Array.from(outfitCache.values()),
          onSome: (payloads) => {
            const incoming = payloads.map(toOutfit);
            const keys = new Set(
              incoming.map((outfit) => outfit.name.toLowerCase()),
            );
            for (const key of outfitCache.keys()) {
              if (!keys.has(key)) outfitCache.delete(key);
            }
            for (const outfit of incoming) {
              const key = outfit.name.toLowerCase();
              const current = outfitCache.get(key);
              if (current !== undefined) current.replaceFrom(outfit);
              else outfitCache.set(key, outfit);
            }
            return Array.from(outfitCache.values());
          },
        }),
      ),
    );
  const getOutfit = (name: string) =>
    getOutfits().pipe(
      Effect.map(
        (outfits) =>
          outfits.find((outfit) => sameText(outfit.name, name)) ?? null,
      ),
    );
  const equipOutfit = (name: string, keepColors = false) =>
    wait
      .forGameAction("equipLoadout")
      .pipe(
        Effect.flatMap((ready) =>
          ready
            ? bridge
                .invoke("outfits.equip", [name, keepColors], Schema.Boolean)
                .pipe(Effect.map(Option.getOrElse(() => false)))
            : Effect.succeed(false),
        ),
      );
  const wearOutfit = (name: string, keepColors = false) =>
    wait
      .forGameAction("wearLoadout")
      .pipe(
        Effect.flatMap((ready) =>
          ready
            ? bridge
                .invoke("outfits.wear", [name, keepColors], Schema.Boolean)
                .pipe(Effect.map(Option.getOrElse(() => false)))
            : Effect.succeed(false),
        ),
      );
  const outfits = {
    equip: equipOutfit,
    get: getOutfit,
    getAll: getOutfits,
    wear: wearOutfit,
  };

  const getCell = () =>
    get().pipe(
      Effect.flatMap((current) =>
        readLocation(current?.cell ?? "", "player.getCell"),
      ),
    );
  const getClassName = () => read("player.getClassName", Schema.String, "");
  const getClassRank = Effect.fn("Player.getClassRank")(function* (
    query?: ItemQuery,
  ) {
    const inventoryClass = findClassItem(yield* inventory.getAll(), query);
    if (inventoryClass !== undefined) return inventoryClass.classRank;
    if (query === undefined || !(yield* store.items.isHydrated("bank"))) {
      return null;
    }

    const bankClass = findClassItem(yield* store.items.getAll("bank"), query);
    return bankClass?.classRank ?? null;
  });
  const getGender = () => read("player.getGender", Schema.String, "");
  const getGold = () => read("player.getGold", WireInt, 0);
  const getHp = () => get().pipe(Effect.map((current) => current?.hp ?? 0));
  const getLevel = () =>
    get().pipe(Effect.map((current) => current?.level ?? 0));
  const getMaxHp = () =>
    get().pipe(Effect.map((current) => current?.maxHp ?? 0));
  const getMaxMp = () =>
    get().pipe(Effect.map((current) => current?.maxMp ?? 0));
  const getMp = () => get().pipe(Effect.map((current) => current?.mp ?? 0));
  const getPad = () =>
    get().pipe(
      Effect.flatMap((current) =>
        readLocation(current?.pad ?? "", "player.getPad"),
      ),
    );
  const getState = () =>
    get().pipe(Effect.map((current) => current?.state ?? EntityState.Idle));
  const getPosition = () =>
    get().pipe(
      Effect.map((current) => ({
        ...(current?.position ?? { x: 0, y: 0 }),
      })),
    );
  const goToPlayer = (name: string) => {
    const username = name.trim();
    return username === ""
      ? Effect.void
      : bridge
          .invoke("player.goToPlayer", [username], Schema.Void)
          .pipe(Effect.asVoid);
  };
  const hasActiveBoost = (boostType: BoostType) =>
    bridge
      .invoke("player.hasActiveBoost", [boostType], Schema.Boolean)
      .pipe(Effect.map(Option.getOrElse(() => false)));
  const isAfk = () =>
    get().pipe(Effect.map((current) => current?.afk ?? false));
  const isAlive = () =>
    get().pipe(
      Effect.flatMap((current) =>
        current !== null
          ? Effect.succeed(current.alive)
          : Effect.all([
              read("player.getHp", WireInt, 0),
              read("player.getState", WireInt, EntityState.Dead),
            ]).pipe(
              Effect.map(([hp, state]) => hp > 0 && state !== EntityState.Dead),
            ),
      ),
    );
  const isMember = () => read("player.isMember", Schema.Boolean, false);
  const isReady = () =>
    store.projection.get.pipe(
      Effect.flatMap((projection) =>
        Object.values(projection.completed).every(Boolean)
          ? Effect.all([
              auth.isLoggedIn(),
              map.isLoaded(),
              read("player.isLoaded", Schema.Boolean, false),
            ]).pipe(
              Effect.map(
                ([loggedIn, loaded, playerLoaded]) =>
                  loggedIn && loaded && playerLoaded,
              ),
            )
          : Effect.succeed(false),
      ),
    );

  const jumpToCell = (cell: string, pad?: string) => {
    const targetCell = cell.trim();
    if (targetCell === "") return Effect.succeed(false);
    const args: Parameters<Window["swf"]["player.jump"]> =
      pad === undefined ? [targetCell] : [targetCell, pad];
    return bridge.invoke("player.jump", args, Schema.Void).pipe(
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.succeed(false),
          onSome: () =>
            wait.until(
              get().pipe(
                Effect.map(
                  (current) =>
                    current !== null &&
                    sameText(current.cell, targetCell) &&
                    (pad === undefined || sameText(current.pad, pad)),
                ),
              ),
              { timeout: "3 seconds" },
            ),
        }),
      ),
    );
  };

  const joinMap = (target: string, cell?: string, pad?: string) =>
    Effect.gen(function* () {
      const destination = yield* parseMapTarget(target);
      if (destination.map === "") return false;
      const targetCell = cell ?? (pad === undefined ? undefined : "Enter");
      const currentMap = yield* store.world.getMap;
      const alreadyLoaded =
        (yield* map.isLoaded()) &&
        sameText(currentMap.name, destination.name) &&
        (!destination.requireExactRoom ||
          currentMap.roomNumber === destination.roomNumber);
      if (alreadyLoaded) {
        return targetCell === undefined
          ? true
          : yield* jumpToCell(targetCell, pad);
      }
      if (!(yield* wait.until(isReady(), { timeout: "10 seconds" })))
        return false;
      if (!(yield* wait.forGameAction("tfer", { timeout: "10 seconds" })))
        return false;
      const args: Parameters<Window["swf"]["player.joinMap"]> =
        cell === undefined && pad === undefined
          ? [destination.map]
          : pad === undefined
            ? [destination.map, cell ?? "Enter"]
            : [destination.map, cell ?? "Enter", pad];
      if (
        Option.isNone(yield* bridge.invoke("player.joinMap", args, Schema.Void))
      )
        return false;
      const loaded = yield* wait.until(
        store.world.getMap.pipe(
          Effect.flatMap((current) =>
            map
              .isLoaded()
              .pipe(
                Effect.map(
                  (ready) =>
                    ready &&
                    sameText(current.name, destination.name) &&
                    (!destination.requireExactRoom ||
                      current.roomNumber === destination.roomNumber),
                ),
              ),
          ),
        ),
        { timeout: "20 seconds" },
      );
      if (!loaded || targetCell === undefined) return loaded;
      return yield* jumpToCell(targetCell, pad);
    });

  const rest = (full = false) =>
    Effect.gen(function* () {
      if (!(yield* wait.forGameAction("rest"))) return;
      const current = yield* get();
      if (
        current !== null &&
        current.hp >= current.maxHp &&
        current.mp >= current.maxMp
      )
        return;
      if (
        Option.isNone(
          yield* bridge.invoke("player.rest", undefined, Schema.Void),
        )
      )
        return;
      if (full) {
        yield* wait.until(
          get().pipe(
            Effect.map(
              (player) =>
                player !== null &&
                player.hp >= player.maxHp &&
                player.mp >= player.maxMp,
            ),
          ),
          { timeout: "10 seconds" },
        );
      }
    });

  const useBoost = (selector: ItemQuery) => inventory.use(selector);

  const walkTo = (x: number, y: number, speed?: number) =>
    Effect.gen(function* () {
      if (!(yield* isAlive())) return false;
      const targetX = Math.trunc(x);
      const targetY = Math.trunc(y);
      const args: Parameters<Window["swf"]["player.walkTo"]> =
        speed === undefined ? [targetX, targetY] : [targetX, targetY, speed];
      const started = yield* bridge
        .invoke("player.walkTo", args, Schema.Boolean)
        .pipe(Effect.map(Option.getOrElse(() => false)));
      if (!started) return false;
      return yield* wait.until(
        get().pipe(
          Effect.map(
            (current) =>
              current?.position.x === targetX && current.position.y === targetY,
          ),
        ),
        { timeout: "3 seconds" },
      );
    });

  return {
    auras,
    factions,
    get,
    getCell,
    getClassName,
    getClassRank,
    getGender,
    getGold,
    getHp,
    getLevel,
    getMaxHp,
    getMaxMp,
    getMp,
    getPad,
    getPosition,
    getState,
    goToPlayer,
    hasActiveBoost,
    isAfk,
    isAlive,
    isMember,
    isReady,
    joinMap,
    jumpToCell,
    outfits,
    rest,
    useBoost,
    walkTo,
  };
};

export type Player = ReturnType<typeof makePlayer>;
