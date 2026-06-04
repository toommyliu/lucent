import { Collection } from "@lucent/collection";
import { Effect, Layer, Option } from "effect";
import { asRecord, asString } from "../PacketPayload";
import { Bridge } from "../Services/Bridge";
import { Outfits } from "../Services/Outfits";
import type {
  Outfit,
  OutfitEquipOptions,
  OutfitsShape,
} from "../Services/Outfits";
import { Wait } from "../Services/Wait";

const normalizeOutfit = (value: unknown): Outfit | null => {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const name = asString(record["name"])?.trim();
  if (!name) {
    return null;
  }

  const { name: _name, ...data } = record;
  return { name, data };
};

const keepColors = (options: OutfitEquipOptions | undefined): boolean =>
  options?.keepColors === true;

const normalizeKey = (value: string): string => value.toLowerCase();

const make = Effect.gen(function* () {
  const bridge = yield* Bridge;
  const wait = yield* Wait;

  const getAll: OutfitsShape["getAll"] = () =>
    bridge
      .call("outfits.getAll")
      .pipe(
        Effect.map((outfits) => {
          const collection = new Collection<string, Outfit>();
          for (const outfit of outfits) {
            const normalized = normalizeOutfit(outfit);
            if (normalized !== null) {
              collection.set(normalizeKey(normalized.name), normalized);
            }
          }

          return collection;
        }),
      );

  const get: OutfitsShape["get"] = (name) =>
    bridge
      .call("outfits.get", [name])
      .pipe(
        Effect.map((outfit) => {
          const normalized = normalizeOutfit(outfit);
          return normalized === null ? Option.none() : Option.some(normalized);
        }),
      );

  const equip: OutfitsShape["equip"] = (name, options) =>
    Effect.gen(function* () {
      const available = yield* wait.forGameAction("equipLoadout", "3 seconds");
      if (!available) {
        return false;
      }

      return yield* bridge.call("outfits.equip", [name, keepColors(options)]);
    });

  const wear: OutfitsShape["wear"] = (name, options) =>
    Effect.gen(function* () {
      const available = yield* wait.forGameAction("wearLoadout", "3 seconds");
      if (!available) {
        return false;
      }

      return yield* bridge.call("outfits.wear", [name, keepColors(options)]);
    });

  return {
    getAll,
    get,
    equip,
    wear,
  } satisfies OutfitsShape;
});

export const OutfitsLive = Layer.effect(Outfits, make);
