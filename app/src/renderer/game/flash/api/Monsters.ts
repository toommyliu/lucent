import { Context, Effect, Layer } from "effect";

import type { AuraRecord, MonsterRecord, MonsterSelector } from "../Types";
import { SwfBridge } from "../SwfBridge";
import { asPositiveInt, equalsIgnoreCase } from "../payload";
import { normalizeMonsterSelector } from "../selectors";
import { WorldState } from "../state/World";

export interface MonsterAuraApi {
  readonly get: (
    monster: MonsterSelector,
    auraName: string,
  ) => Effect.Effect<AuraRecord | null>;
  readonly getAll: (
    monster: MonsterSelector,
  ) => Effect.Effect<readonly AuraRecord[]>;
  readonly has: (
    monster: MonsterSelector,
    auraName: string,
  ) => Effect.Effect<boolean>;
}

export interface MonstersApiShape {
  readonly auras: MonsterAuraApi;
  readonly get: (
    selector: MonsterSelector,
  ) => Effect.Effect<MonsterRecord | null>;
  readonly getAll: Effect.Effect<readonly MonsterRecord[]>;
  readonly getAvailable: Effect.Effect<readonly MonsterRecord[]>;
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

    const getAuras = (monster: MonsterSelector) =>
      Effect.gen(function* () {
        const target = yield* world.getMonster(monster);
        return target === null
          ? []
          : yield* world.getMonsterAuras(target.monsterMapId);
      });

    const auras: MonsterAuraApi = {
      get: (monster, auraName) =>
        getAuras(monster).pipe(
          Effect.map(
            (auras) =>
              auras.find((aura) => equalsIgnoreCase(aura.name, auraName)) ??
              null,
          ),
        ),
      getAll: getAuras,
      has: (monster, auraName) =>
        auras.get(monster, auraName).pipe(Effect.map((aura) => aura !== null)),
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
      getAvailable: bridge.call("world.getAvailableMonsterMapIds").pipe(
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
          monsters.filter(
            (monster): monster is MonsterRecord => monster !== null,
          ),
        ),
      ),
      isAvailable,
    });
  }),
);
