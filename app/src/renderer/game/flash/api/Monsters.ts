import { Context, Effect, Layer } from "effect";

import type {
  Aura,
  AuraQueryOptions,
  Monster,
  MonsterSelector,
} from "../Types";
import { SwfBridge } from "../SwfBridge";
import { asPositiveInt, equalsIgnoreCase } from "../payload";
import { normalizeMonsterSelector } from "../selectors";
import { WorldState } from "../state/World";

export interface MonsterAuraApi {
  readonly get: (
    monster: MonsterSelector,
    auraName: string,
    options?: AuraQueryOptions,
  ) => Effect.Effect<Aura | null>;
  readonly getAll: (
    monster: MonsterSelector,
    options?: AuraQueryOptions,
  ) => Effect.Effect<readonly Aura[]>;
  readonly has: (
    monster: MonsterSelector,
    auraName: string,
    options?: AuraQueryOptions,
  ) => Effect.Effect<boolean>;
}

export interface MonstersApiShape {
  readonly auras: MonsterAuraApi;
  readonly get: (selector: MonsterSelector) => Effect.Effect<Monster | null>;
  readonly getAll: () => Effect.Effect<readonly Monster[]>;
  readonly getAvailable: () => Effect.Effect<readonly Monster[]>;
  readonly isAvailable: (selector: MonsterSelector) => Effect.Effect<boolean>;
}

export class MonstersApi extends Context.Service<
  MonstersApi,
  MonstersApiShape
>()("lucent/game/flash/api/Monsters") {}

export const layer = Layer.effect(
  MonstersApi,
  Effect.gen(function* () {
    const bridge = yield* SwfBridge;
    const world = yield* WorldState;

    const getAuras = (monster: MonsterSelector, options?: AuraQueryOptions) =>
      Effect.gen(function* () {
        const target = yield* world.getMonster(monster);
        return target === null
          ? []
          : yield* world.getMonsterAuras(target.monsterMapId, options);
      });

    const auras: MonsterAuraApi = {
      get: (monster, auraName, options) =>
        getAuras(monster, options).pipe(
          Effect.map(
            (auras) =>
              auras.find((aura) => equalsIgnoreCase(aura.name, auraName)) ??
              null,
          ),
        ),
      getAll: getAuras,
      has: (monster, auraName, options) =>
        auras
          .get(monster, auraName, options)
          .pipe(Effect.map((aura) => aura !== null)),
    };

    const isAvailable: MonstersApiShape["isAvailable"] = (selector) =>
      Effect.gen(function* () {
        const normalized = normalizeMonsterSelector(selector);
        if (normalized === null) {
          return false;
        }

        const monster = yield* world.getMonster(normalized);
        if (monster === null) {
          return false;
        }

        return yield* bridge.call("world.isMonsterAvailable", [
          monster.monsterMapId,
        ]);
      });

    return MonstersApi.of({
      auras,
      get: world.getMonster,
      getAll: world.getMonsters,
      getAvailable: () =>
        bridge.call("world.getAvailableMonsterMapIds").pipe(
          Effect.flatMap((ids) =>
            Effect.forEach(
              Array.isArray(ids) ? ids.map(asPositiveInt) : [],
              (id) =>
                id === undefined
                  ? Effect.succeed(null)
                  : world.getMonster({ monMapId: id }),
            ),
          ),
          Effect.map((monsters) =>
            monsters.filter((monster): monster is Monster => monster !== null),
          ),
        ),
      isAvailable,
    });
  }),
);
