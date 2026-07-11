import {
  EntityState,
  LiveFaction,
  LiveOutfit,
  type Faction,
  type Outfit,
} from "@lucent/game";
import { Effect, Option, Schema } from "effect";

import type { BridgeService } from "../bridge/Bridge";
import { PositiveWireInt, WireInt } from "../contract/Coercion";
import { decodeItemSelector } from "../domain/Selectors";
import type { Store } from "../state/Store";
import type { Auth } from "./Auth";
import type { Inventory } from "./Inventory";
import type { Map } from "./Map";
import type { Wait } from "./Wait";

const Position = Schema.Tuple([WireInt, WireInt]);
const FactionPayload = Schema.Struct({
  FactionID: PositiveWireInt,
  iRank: Schema.optionalKey(WireInt),
  iRep: Schema.optionalKey(WireInt),
  sName: Schema.String,
});
const FactionPayloads = Schema.Array(FactionPayload);
const OutfitPayload = Schema.Struct({
  None: Schema.optionalKey(PositiveWireInt),
  Weapon: Schema.optionalKey(PositiveWireInt),
  ar: Schema.optionalKey(PositiveWireInt),
  ba: Schema.optionalKey(PositiveWireInt),
  co: Schema.optionalKey(PositiveWireInt),
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
  he: Schema.optionalKey(PositiveWireInt),
  mi: Schema.optionalKey(PositiveWireInt),
  name: Schema.String,
  pe: Schema.optionalKey(PositiveWireInt),
});
const OutfitPayloads = Schema.Array(OutfitPayload);

const toFaction = (payload: typeof FactionPayload.Type): Faction =>
  new LiveFaction({
    id: payload.FactionID,
    name: payload.sName,
    rank: payload.iRank ?? 0,
    reputation: payload.iRep ?? 0,
  });

const toOutfit = (payload: typeof OutfitPayload.Type): Outfit =>
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
      armorItemId: payload.co,
      capeItemId: payload.ba,
      classItemId: payload.ar,
      helmItemId: payload.he,
      itemId: payload.None,
      miscItemId: payload.mi,
      petItemId: payload.pe,
      weaponItemId: payload.Weapon,
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
  const getAuras = (options?: { kind?: "active" | "passive" }) =>
    get().pipe(
      Effect.flatMap((player) =>
        player === null
          ? Effect.succeed([])
          : store.world.getPlayerAuras(player.entityId, options),
      ),
    );

  return {
    auras: {
      get: (name: string, options?: { kind?: "active" | "passive" }) =>
        getAuras(options).pipe(
          Effect.map(
            (auras) =>
              auras.find(
                (aura) =>
                  aura.name.localeCompare(name, undefined, {
                    sensitivity: "accent",
                  }) === 0,
              ) ?? null,
          ),
        ),
      getAll: getAuras,
    },
    factions: {
      get: (name: string) =>
        bridge.invoke("player.getFactions", undefined, FactionPayloads).pipe(
          Effect.map(
            Option.match({
              onNone: () => null,
              onSome: (payloads) =>
                payloads.map(toFaction).find(
                  (faction) =>
                    faction.name.localeCompare(name, undefined, {
                      sensitivity: "accent",
                    }) === 0,
                ) ?? null,
            }),
          ),
        ),
      getAll: () =>
        bridge.invoke("player.getFactions", undefined, FactionPayloads).pipe(
          Effect.map(
            Option.match({
              onNone: () => [],
              onSome: (payloads) => payloads.map(toFaction),
            }),
          ),
        ),
    },
    get,
    getCell: () => get().pipe(Effect.map((player) => player?.cell ?? "")),
    getClassName: () => read("player.getClassName", Schema.String, ""),
    getGender: () => read("player.getGender", Schema.String, ""),
    getGold: () => read("player.getGold", WireInt, 0),
    getHp: () => get().pipe(Effect.map((player) => player?.hp ?? 0)),
    getLevel: () => get().pipe(Effect.map((player) => player?.level ?? 0)),
    getMaxHp: () => get().pipe(Effect.map((player) => player?.maxHp ?? 0)),
    getMaxMp: () => get().pipe(Effect.map((player) => player?.maxMp ?? 0)),
    getMp: () => get().pipe(Effect.map((player) => player?.mp ?? 0)),
    getPad: () => get().pipe(Effect.map((player) => player?.pad ?? "")),
    getPosition: () =>
      get().pipe(
        Effect.flatMap((player) =>
          player !== null
            ? Effect.succeed({ ...player.position })
            : bridge.invoke("player.getPosition", undefined, Position).pipe(
                Effect.map(
                  Option.match({
                    onNone: () => ({ x: 0, y: 0 }),
                    onSome: ([x, y]) => ({ x, y }),
                  }),
                ),
              ),
        ),
      ),
    getState: () =>
      get().pipe(Effect.map((player) => player?.state ?? EntityState.Idle)),
    goToPlayer: (name: string) =>
      bridge
        .invoke("player.goToPlayer", [name], Schema.Void)
        .pipe(Effect.asVoid),
    hasActiveBoost: (boostType: string) =>
      bridge
        .invoke("player.hasActiveBoost", [boostType], Schema.Boolean)
        .pipe(Effect.map(Option.getOrElse(() => false))),
    isAfk: () => get().pipe(Effect.map((player) => player?.afk ?? false)),
    isAlive: () => get().pipe(Effect.map((player) => player?.alive ?? false)),
    isMember: () => read("player.isMember", Schema.Boolean, false),
    isReady: () =>
      Effect.all([auth.isLoggedIn(), map.isLoaded(), get()]).pipe(
        Effect.map(
          ([loggedIn, loaded, player]) => loggedIn && loaded && player !== null,
        ),
      ),
    joinMap: (target: string, cell = "Enter", pad = "Spawn") => {
      const destination = target.trim();
      if (destination === "") return Effect.succeed(false);
      return bridge
        .invoke("player.joinMap", [destination, cell, pad], Schema.Void)
        .pipe(
          Effect.flatMap(
            Option.match({
              onNone: () => Effect.succeed(false),
              onSome: () =>
                wait.until(
                  store.world.getMap.pipe(
                    Effect.map((current) =>
                      destination
                        .toLowerCase()
                        .startsWith(current.name.toLowerCase()),
                    ),
                  ),
                  { timeout: "10 seconds" },
                ),
            }),
          ),
        );
    },
    jumpToCell: (cell: string, pad = "Spawn") =>
      bridge.invoke("player.jump", [cell, pad], Schema.Void).pipe(
        Effect.flatMap(
          Option.match({
            onNone: () => Effect.succeed(false),
            onSome: () =>
              wait.until(
                get().pipe(Effect.map((player) => player?.cell === cell)),
                { timeout: "3 seconds" },
              ),
          }),
        ),
      ),
    outfits: {
      equip: (name: string, keepColors = false) =>
        bridge
          .invoke("outfits.equip", [name, keepColors], Schema.Boolean)
          .pipe(Effect.map(Option.getOrElse(() => false))),
      get: (name: string) =>
        bridge.invoke("outfits.getAll", undefined, OutfitPayloads).pipe(
          Effect.map(
            Option.match({
              onNone: () => null,
              onSome: (payloads) =>
                payloads.map(toOutfit).find(
                  (outfit) =>
                    outfit.name.localeCompare(name, undefined, {
                      sensitivity: "accent",
                    }) === 0,
                ) ?? null,
            }),
          ),
        ),
      getAll: () =>
        bridge.invoke("outfits.getAll", undefined, OutfitPayloads).pipe(
          Effect.map(
            Option.match({
              onNone: () => [],
              onSome: (payloads) => payloads.map(toOutfit),
            }),
          ),
        ),
      wear: (name: string, keepColors = false) =>
        bridge
          .invoke("outfits.wear", [name, keepColors], Schema.Boolean)
          .pipe(Effect.map(Option.getOrElse(() => false))),
    },
    rest: (full = false) =>
      bridge.invoke("player.rest", undefined, Schema.Void).pipe(
        Effect.flatMap(() =>
          full
            ? wait.until(
                get().pipe(
                  Effect.map(
                    (player) =>
                      player !== null &&
                      player.hp >= player.maxHp &&
                      player.mp >= player.maxMp,
                  ),
                ),
                { timeout: "10 seconds" },
              )
            : Effect.succeed(true),
        ),
        Effect.asVoid,
      ),
    useBoost: (selector: unknown) => {
      const decoded = decodeItemSelector(selector);
      if (Option.isNone(decoded)) return Effect.succeed(false);
      return inventory
        .get(decoded.value)
        .pipe(
          Effect.flatMap((item) =>
            item === null
              ? Effect.succeed(false)
              : bridge
                  .invoke("player.useBoost", [item.itemId], Schema.Boolean)
                  .pipe(Effect.map(Option.getOrElse(() => false))),
          ),
        );
    },
    walkTo: (x: number, y: number, speed?: number) =>
      bridge
        .invoke("player.walkTo", [x, y, speed], Schema.Boolean)
        .pipe(Effect.map(Option.getOrElse(() => false))),
  };
};

export type Player = ReturnType<typeof makePlayer>;
