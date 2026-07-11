import { EntityState, LiveMonster, LivePlayer } from "@lucent/game";
import type { MonsterData, PlayerData } from "@lucent/game";
import { Schema } from "effect";

import { PositiveWireInt, WireBoolean, WireInt, WireNumber } from "../Coercion";

const EntityStatePayload = WireInt.check(
  Schema.isBetween({ minimum: 0, maximum: 2 }),
);

const toEntityState = (
  value: number | undefined,
  fallback: EntityState,
): EntityState => {
  switch (value) {
    case EntityState.Dead:
      return EntityState.Dead;
    case EntityState.Idle:
      return EntityState.Idle;
    case EntityState.InCombat:
      return EntityState.InCombat;
    default:
      return fallback;
  }
};

export const PlayerPayload = Schema.Struct({
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
  strUsername: Schema.String,
  tx: Schema.optionalKey(WireNumber),
  ty: Schema.optionalKey(WireNumber),
});
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
  strFrame: Schema.optionalKey(Schema.String),
  strPad: Schema.optionalKey(Schema.String),
  tx: Schema.optionalKey(WireNumber),
  ty: Schema.optionalKey(WireNumber),
});
export type EntityPatchPayload = typeof EntityPatchPayload.Type;

export const PlayerPayloads = Schema.Array(PlayerPayload);
export const MonsterPayloads = Schema.Array(MonsterPayload);

export const toPlayer = (
  payload: PlayerPayload,
  defaults: Partial<PlayerData> = {},
): LivePlayer =>
  new LivePlayer({
    afk: payload.afk ?? defaults.afk ?? false,
    cell: payload.strFrame ?? defaults.cell ?? "",
    entityId: payload.entID,
    entityType: payload.entType ?? defaults.entityType ?? "player",
    hp: payload.intHP ?? defaults.hp ?? 0,
    level: payload.intLevel ?? defaults.level ?? 0,
    maxHp: payload.intHPMax ?? defaults.maxHp ?? 0,
    maxMp: payload.intMPMax ?? defaults.maxMp ?? 0,
    mp: payload.intMP ?? defaults.mp ?? 0,
    name: payload.strUsername,
    pad: payload.strPad ?? defaults.pad ?? "",
    position: {
      x: payload.tx ?? defaults.position?.x ?? 0,
      y: payload.ty ?? defaults.position?.y ?? 0,
    },
    state: toEntityState(payload.intState, defaults.state ?? EntityState.Idle),
    username: payload.strUsername,
  });

export const toMonster = (
  payload: MonsterPayload,
  defaults: Partial<MonsterData> = {},
): LiveMonster =>
  new LiveMonster({
    cell: payload.strFrame ?? defaults.cell ?? "",
    hp: payload.intHP ?? defaults.hp ?? 0,
    level: payload.iLvl ?? defaults.level ?? 0,
    maxHp: payload.intHPMax ?? defaults.maxHp ?? 0,
    maxMp: payload.intMPMax ?? defaults.maxMp ?? 0,
    monsterId: payload.MonID ?? defaults.monsterId ?? 0,
    monsterMapId: payload.MonMapID,
    mp: payload.intMP ?? defaults.mp ?? 0,
    name: payload.strMonName ?? defaults.name ?? `Monster ${payload.MonMapID}`,
    race: payload.sRace ?? defaults.race ?? "",
    state: toEntityState(payload.intState, defaults.state ?? EntityState.Idle),
  });

export const entityState = (
  value: number | undefined,
): EntityState | undefined =>
  value === undefined ? undefined : toEntityState(value, EntityState.Idle);
