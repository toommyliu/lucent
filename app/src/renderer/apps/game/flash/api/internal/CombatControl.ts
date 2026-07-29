import { EntityState } from "@lucent/game";
import { Effect, Option, Schema } from "effect";

import type { BridgeService } from "../../bridge/Bridge";
import { WireBoolean, WireInt } from "../../contract/Coercion";

const EntityStatePayload = WireInt.check(
  Schema.isBetween({
    minimum: EntityState.Dead,
    maximum: EntityState.InCombat,
  }),
);
const CombatTargetPayload = Schema.NullOr(
  Schema.Union([
    Schema.Struct({
      cell: Schema.String,
      hp: WireInt,
      level: WireInt,
      maxHp: WireInt,
      monsterId: WireInt,
      monsterMapId: WireInt,
      name: Schema.String,
      race: Schema.String,
      state: EntityStatePayload,
      type: Schema.Literal("monster"),
    }),
    Schema.Struct({
      afk: WireBoolean,
      cell: Schema.String,
      entityId: WireInt,
      entityType: Schema.String,
      hp: WireInt,
      level: WireInt,
      maxHp: WireInt,
      maxMp: WireInt,
      mp: WireInt,
      name: Schema.String,
      pad: Schema.String,
      sp: WireInt,
      state: EntityStatePayload,
      type: Schema.Literal("player"),
      username: Schema.String,
    }),
  ]),
);

export const readCombatTarget = (bridge: BridgeService) =>
  bridge
    .invoke("combat.getTarget", undefined, CombatTargetPayload)
    .pipe(Effect.map(Option.getOrNull));

export const stopCombat = (bridge: BridgeService) =>
  Effect.all(
    [
      bridge.invoke("combat.cancelAutoAttack", undefined, Schema.Void),
      bridge.invoke("combat.cancelTarget", undefined, Schema.Void),
    ],
    { discard: true },
  ).pipe(Effect.asVoid);
