import { toMonsterSelector } from "@lucent/game";
import type { MonsterQuery } from "@lucent/game";
import { Effect, Option, Schema } from "effect";

import type { BridgeService } from "../bridge/Bridge";
import { UnknownRecord } from "../contract/Coercion";
import { MonsterPayload, toMonster } from "../contract/payload/World";
import type { Store } from "../state/Store";

const NestedMonster = Schema.Struct({
  dataLeaf: UnknownRecord,
  objData: Schema.optionalKey(UnknownRecord),
});
const NullableMonster = Schema.NullOr(
  Schema.Union([MonsterPayload, NestedMonster]),
);
const decodeMonster = Schema.decodeUnknownOption(MonsterPayload);

export const makeMonsters = (bridge: BridgeService, store: Store) => {
  const get = (selector: MonsterQuery) => {
    return store.world.getMonster(selector).pipe(
      Effect.flatMap((current) =>
        current !== null
          ? Effect.succeed(current)
          : bridge
              .invoke(
                "world.getMonster",
                [toMonsterSelector(selector)],
                NullableMonster,
              )
              .pipe(
                Effect.flatMap(
                  Option.match({
                    onNone: () => Effect.succeed(null),
                    onSome: (payload) => {
                      if (payload === null) return Effect.succeed(null);
                      const decoded =
                        "dataLeaf" in payload
                          ? decodeMonster({
                              ...payload.objData,
                              ...payload.dataLeaf,
                            })
                          : Option.some(payload);
                      return Option.isNone(decoded)
                        ? Effect.succeed(null)
                        : store.world.putMonster(toMonster(decoded.value));
                    },
                  }),
                ),
              ),
      ),
    );
  };

  const getAuras = (
    selector: MonsterQuery,
    options?: { kind?: "active" | "passive" },
  ) =>
    get(selector).pipe(
      Effect.flatMap((monster) =>
        monster === null
          ? Effect.succeed([])
          : store.world.getMonsterAuras(monster.monsterMapId, options),
      ),
    );

  const getAura = (
    selector: MonsterQuery,
    name: string,
    options?: { kind?: "active" | "passive" },
  ) =>
    getAuras(selector, options).pipe(
      Effect.map(
        (auras) =>
          auras.find(
            (aura) =>
              aura.name.localeCompare(name, undefined, {
                sensitivity: "accent",
              }) === 0,
          ) ?? null,
      ),
    );

  const hasAura = (
    selector: MonsterQuery,
    name: string,
    options?: { kind?: "active" | "passive" },
  ) =>
    getAura(selector, name, options).pipe(Effect.map((aura) => aura !== null));

  const auras = { get: getAura, getAll: getAuras, has: hasAura };
  const getAll = () => store.world.getMonsters;
  const getAvailable = () =>
    store.world.getMonsters.pipe(
      Effect.map((monsters) => monsters.filter((monster) => monster.alive)),
    );
  const isAvailable = (selector: MonsterQuery) =>
    get(selector).pipe(Effect.map((monster) => monster?.alive === true));

  return {
    auras,
    get,
    getAll,
    getAvailable,
    isAvailable,
  };
};

export type Monsters = ReturnType<typeof makeMonsters>;
