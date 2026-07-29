import { EntityState, LiveMonster, LivePlayer } from "@lucent/game";
import * as Schema from "effect/Schema";

import { PositiveWireInt, WireBoolean, WireInt, WireNumber } from "../Coercion";

const EntityStatePayload = WireInt.check(
  Schema.isBetween({ minimum: 0, maximum: 2 }),
);

const toEntityState = (value: number | undefined): EntityState => {
  switch (value) {
    case EntityState.Dead:
      return EntityState.Dead;
    case EntityState.Idle:
      return EntityState.Idle;
    case EntityState.InCombat:
      return EntityState.InCombat;
    default:
      return EntityState.Idle;
  }
};

const PlayerFields = {
  afk: Schema.optionalKey(WireBoolean),
  entID: PositiveWireInt,
  entType: Schema.optionalKey(Schema.String),
  intHP: Schema.optionalKey(WireInt),
  intHPMax: Schema.optionalKey(WireInt),
  intLevel: Schema.optionalKey(WireInt),
  intMP: Schema.optionalKey(WireInt),
  intMPMax: Schema.optionalKey(WireInt),
  intState: Schema.optionalKey(EntityStatePayload),
  strFrame: Schema.optionalKey(Schema.String),
  strPad: Schema.optionalKey(Schema.String),
  tx: Schema.optionalKey(WireNumber),
  ty: Schema.optionalKey(WireNumber),
};

export const PlayerPayload = Schema.Union([
  Schema.Struct({
    ...PlayerFields,
    strUsername: Schema.String,
  }),
  Schema.Struct({
    ...PlayerFields,
    uoName: Schema.String,
  }),
]);
export type PlayerPayload = typeof PlayerPayload.Type;

export const MonsterPayload = Schema.Struct({
  MonID: Schema.optionalKey(PositiveWireInt),
  MonMapID: PositiveWireInt,
  iLvl: Schema.optionalKey(WireInt),
  intHP: Schema.optionalKey(WireInt),
  intHPMax: Schema.optionalKey(WireInt),
  intMP: Schema.optionalKey(WireInt),
  intMPMax: Schema.optionalKey(WireInt),
  intState: Schema.optionalKey(EntityStatePayload),
  sRace: Schema.optionalKey(Schema.String),
  strFrame: Schema.optionalKey(Schema.String),
  strMonName: Schema.optionalKey(Schema.String),
});
export type MonsterPayload = typeof MonsterPayload.Type;

export const EntityPatchPayload = Schema.Struct({
  afk: Schema.optionalKey(WireBoolean),
  entID: Schema.optionalKey(PositiveWireInt),
  intHP: Schema.optionalKey(WireInt),
  intHPMax: Schema.optionalKey(WireInt),
  intLevel: Schema.optionalKey(WireInt),
  intMP: Schema.optionalKey(WireInt),
  intMPMax: Schema.optionalKey(WireInt),
  intState: Schema.optionalKey(EntityStatePayload),
  px: Schema.optionalKey(WireNumber),
  py: Schema.optionalKey(WireNumber),
  strFrame: Schema.optionalKey(Schema.String),
  strPad: Schema.optionalKey(Schema.String),
  tx: Schema.optionalKey(WireNumber),
  ty: Schema.optionalKey(WireNumber),
});
export type EntityPatchPayload = typeof EntityPatchPayload.Type;

export const PlayerPayloads = Schema.Array(PlayerPayload);
export const MonsterPayloads = Schema.Array(MonsterPayload);

export const toPlayer = (payload: PlayerPayload): LivePlayer => {
  const username =
    "strUsername" in payload ? payload.strUsername : payload.uoName;

  return new LivePlayer({
    afk: payload.afk ?? false,
    cell: payload.strFrame ?? "",
    entityId: payload.entID,
    entityType: payload.entType ?? "player",
    hp: payload.intHP ?? 0,
    level: payload.intLevel ?? 0,
    maxHp: payload.intHPMax ?? 0,
    maxMp: payload.intMPMax ?? 0,
    mp: payload.intMP ?? 0,
    pad: payload.strPad ?? "",
    position: {
      x: payload.tx ?? 0,
      y: payload.ty ?? 0,
    },
    state: toEntityState(payload.intState),
    username,
  });
};

export const toMonster = (payload: MonsterPayload): LiveMonster =>
  new LiveMonster({
    cell: payload.strFrame ?? "",
    hp: payload.intHP ?? 0,
    level: payload.iLvl ?? 0,
    maxHp: payload.intHPMax ?? 0,
    maxMp: payload.intMPMax ?? 0,
    monsterId: payload.MonID ?? 0,
    monsterMapId: payload.MonMapID,
    mp: payload.intMP ?? 0,
    name: payload.strMonName ?? `Monster ${payload.MonMapID}`,
    race: payload.sRace ?? "",
    state: toEntityState(payload.intState),
  });

export const entityState = (
  value: number | undefined,
): EntityState | undefined =>
  value === undefined ? undefined : toEntityState(value);
