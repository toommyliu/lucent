import { Option, Schema } from "effect";

import { PositiveWireInt } from "../contract/Coercion";

export type ItemSelector =
  | { readonly itemId: number }
  | { readonly name: string };

export type ShopSelector = ItemSelector | { readonly shopItemId: number };

export type MonsterSelector =
  | { readonly monMapId: number }
  | { readonly name: string };

const ItemInput = Schema.Union([
  PositiveWireInt,
  Schema.String,
  Schema.Struct({ itemId: PositiveWireInt }),
  Schema.Struct({ name: Schema.String }),
]);
const ShopInput = Schema.Union([
  ItemInput,
  Schema.Struct({ shopItemId: PositiveWireInt }),
]);
const MonsterInput = Schema.Union([
  PositiveWireInt,
  Schema.String,
  Schema.Struct({ monMapId: PositiveWireInt }),
  Schema.Struct({ name: Schema.String }),
]);

const decodeItemInput = Schema.decodeUnknownOption(ItemInput);
const decodeShopInput = Schema.decodeUnknownOption(ShopInput);
const decodeMonsterInput = Schema.decodeUnknownOption(MonsterInput);
const monsterMapIdToken = /^id[.:'-]?([1-9]\d*)$/iu;

export const parseMonsterMapIdToken = (value: string): number | undefined => {
  const match = value.trim().match(monsterMapIdToken);
  return match?.[1] === undefined ? undefined : Number(match[1]);
};

const itemSelector = (
  value: typeof ItemInput.Type,
): Option.Option<ItemSelector> => {
  if (typeof value === "number") return Option.some({ itemId: value });
  if (typeof value === "string") {
    const name = value.trim();
    return name === "" ? Option.none() : Option.some({ name });
  }
  if ("itemId" in value) return Option.some(value);
  const name = value.name.trim();
  return name === "" ? Option.none() : Option.some({ name });
};

export const decodeItemSelector = (
  value: unknown,
): Option.Option<ItemSelector> =>
  Option.flatMap(decodeItemInput(value), itemSelector);

export const decodeShopSelector = (
  value: unknown,
): Option.Option<ShopSelector> =>
  Option.flatMap(
    decodeShopInput(value),
    (decoded): Option.Option<ShopSelector> =>
      typeof decoded === "object" && "shopItemId" in decoded
        ? Option.some<ShopSelector>(decoded)
        : itemSelector(decoded),
  );

export const decodeMonsterSelector = (
  value: unknown,
): Option.Option<MonsterSelector> =>
  Option.flatMap(decodeMonsterInput(value), (decoded) => {
    if (typeof decoded === "number") {
      return Option.some({ monMapId: decoded });
    }
    if (typeof decoded === "object") {
      if ("monMapId" in decoded) return Option.some(decoded);
      const name = decoded.name.trim();
      return name === "" ? Option.none() : Option.some({ name });
    }
    const token = decoded.trim();
    const parsedMapId = parseMonsterMapIdToken(token);
    if (parsedMapId !== undefined) {
      return Option.some({ monMapId: parsedMapId });
    }
    if (/^[1-9]\d*$/.test(token)) {
      return Option.some({ monMapId: Number(token) });
    }
    return token === "" ? Option.none() : Option.some({ name: token });
  });

export const quantity = (value: number | undefined): number =>
  value === undefined || !Number.isFinite(value)
    ? 1
    : Math.max(1, Math.trunc(value));
