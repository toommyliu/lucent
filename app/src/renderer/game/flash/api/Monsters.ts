import { Effect, Option, Schema } from "effect";

import type { BridgeService } from "../bridge/Bridge";
import { MonsterPayload, toMonster } from "../contract/payload/World";
import { decodeMonsterSelector } from "../domain/Selectors";
import type { Store } from "../state/Store";

const NullableMonster = Schema.NullOr(MonsterPayload);

export const makeMonsters = (bridge: BridgeService, store: Store) => {
  const get = (selector: unknown) => {
    const decoded = decodeMonsterSelector(selector);
    if (Option.isNone(decoded)) return Effect.succeed(null);
    return store.world.getMonster(decoded.value).pipe(
      Effect.flatMap((current) =>
        current !== null
          ? Effect.succeed(current)
          : bridge
              .invoke("world.getMonster", [decoded.value], NullableMonster)
              .pipe(
                Effect.flatMap(
                  Option.match({
                    onNone: () => Effect.succeed(null),
                    onSome: (payload) =>
                      payload === null
                        ? Effect.succeed(null)
                        : store.world.putMonster(toMonster(payload)),
                  }),
                ),
              ),
      ),
    );
  };

  const getAuras = (
    selector: unknown,
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
    selector: unknown,
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
    selector: unknown,
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
  const isAvailable = (selector: unknown) =>
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
