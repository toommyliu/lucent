import { Effect, Option, Schema } from "effect";

import { PositiveWireInt, UnknownRecord } from "../contract/Coercion";
import type { Event } from "../contract/Event";
import { packetData, type Packet } from "../contract/Packet";
import {
  EntityPatchPayload,
  MonsterPayload,
  PlayerPayload,
  entityState,
  toMonster,
  toPlayer,
  type EntityPatchPayload as EntityPatch,
} from "../contract/payload/World";
import type { Store } from "../state/Store";

const MoveArea = Schema.Struct({
  areaId: Schema.optionalKey(PositiveWireInt),
  areaName: Schema.optionalKey(Schema.String),
  monBranch: Schema.optionalKey(Schema.Array(UnknownRecord)),
  mondef: Schema.optionalKey(Schema.Array(UnknownRecord)),
  monmap: Schema.optionalKey(Schema.Array(UnknownRecord)),
  uoBranch: Schema.optionalKey(Schema.Array(PlayerPayload)),
});
const PlayerUpdate = Schema.Struct({
  o: EntityPatchPayload,
  unm: Schema.String,
});
const MonsterUpdate = Schema.Struct({
  id: PositiveWireInt,
  o: EntityPatchPayload,
});
const decodeMoveArea = Schema.decodeUnknownOption(MoveArea);
const decodePlayer = Schema.decodeUnknownOption(PlayerPayload);
const decodeMonster = Schema.decodeUnknownOption(MonsterPayload);
const decodePlayerUpdate = Schema.decodeUnknownOption(PlayerUpdate);
const decodeMonsterUpdate = Schema.decodeUnknownOption(MonsterUpdate);
const decodePositiveInt = Schema.decodeUnknownOption(PositiveWireInt);
const decodeString = Schema.decodeUnknownOption(Schema.String);

const parseMap = (area: string | undefined) => {
  const value = area?.trim() ?? "";
  const match = value.match(/^(.*?)(?:-(\d+))?$/);
  return {
    name: match?.[1] ?? value,
    roomNumber: match?.[2] === undefined ? 0 : Number(match[2]),
  };
};

const playerPatch = (
  patch: EntityPatch,
  currentPosition: { readonly x: number; readonly y: number },
) => ({
  ...(patch.afk === undefined ? {} : { afk: patch.afk }),
  ...(patch.entID === undefined ? {} : { entityId: patch.entID }),
  ...(patch.intHP === undefined ? {} : { hp: patch.intHP }),
  ...(patch.intHPMax === undefined ? {} : { maxHp: patch.intHPMax }),
  ...(patch.intLevel === undefined ? {} : { level: patch.intLevel }),
  ...(patch.intMP === undefined ? {} : { mp: patch.intMP }),
  ...(patch.intMPMax === undefined ? {} : { maxMp: patch.intMPMax }),
  ...(entityState(patch.intState) === undefined
    ? {}
    : { state: entityState(patch.intState)! }),
  ...(patch.strFrame === undefined ? {} : { cell: patch.strFrame }),
  ...(patch.strPad === undefined ? {} : { pad: patch.strPad }),
  ...(patch.tx === undefined && patch.ty === undefined
    ? {}
    : {
        position: {
          x: patch.tx ?? currentPosition.x,
          y: patch.ty ?? currentPosition.y,
        },
      }),
});

const monsterPatch = (patch: EntityPatch) => ({
  ...(patch.intHP === undefined ? {} : { hp: patch.intHP }),
  ...(patch.intHPMax === undefined ? {} : { maxHp: patch.intHPMax }),
  ...(patch.intMP === undefined ? {} : { mp: patch.intMP }),
  ...(patch.intMPMax === undefined ? {} : { maxMp: patch.intMPMax }),
  ...(entityState(patch.intState) === undefined
    ? {}
    : { state: entityState(patch.intState)! }),
  ...(patch.strFrame === undefined ? {} : { cell: patch.strFrame }),
});

const projectMoveArea = (store: Store, packet: Packet) =>
  Effect.gen(function* () {
    const decoded = decodeMoveArea(packetData(packet));
    if (Option.isNone(decoded)) return [];
    const previousAuth = yield* store.auth.get;
    const mapName = parseMap(decoded.value.areaName);
    const map = {
      id: decoded.value.areaId ?? 0,
      ...mapName,
    };

    const definitions = new Map<number, Record<string, unknown>>();
    for (const definition of decoded.value.mondef ?? []) {
      const id = decodePositiveInt(definition["MonID"]);
      if (Option.isSome(id)) definitions.set(id.value, definition);
    }
    const cells = new Map<number, string>();
    for (const placement of decoded.value.monmap ?? []) {
      const id = decodePositiveInt(placement["MonMapID"]);
      const cell = decodeString(placement["strFrame"]);
      if (Option.isSome(id) && Option.isSome(cell))
        cells.set(id.value, cell.value);
    }
    const monsters = (decoded.value.monBranch ?? []).flatMap((branch) => {
      const monsterId = decodePositiveInt(branch["MonID"]);
      const monsterMapId = decodePositiveInt(branch["MonMapID"]);
      if (Option.isNone(monsterId) || Option.isNone(monsterMapId)) return [];
      const decodedMonster = decodeMonster({
        ...definitions.get(monsterId.value),
        ...branch,
        ...(cells.get(monsterMapId.value) === undefined
          ? {}
          : { strFrame: cells.get(monsterMapId.value) }),
      });
      return Option.isNone(decodedMonster)
        ? []
        : [toMonster(decodedMonster.value)];
    });
    const players = (decoded.value.uoBranch ?? []).map((player) =>
      toPlayer(player),
    );

    yield* store.world.clearArea;
    yield* store.world.setMap(map);
    yield* store.world.setMonsters(monsters);
    yield* store.world.setPlayers(players);
    const self = players.find(
      (player) =>
        player.username.localeCompare(previousAuth.username, undefined, {
          sensitivity: "accent",
        }) === 0,
    );
    if (self !== undefined) yield* store.world.setSelf(self.username);
    return [{ type: "join-map", map }] satisfies readonly Event[];
  });

export const projectWorld = (
  store: Store,
  packet: Packet,
): Effect.Effect<readonly Event[]> =>
  Effect.gen(function* () {
    switch (packet.command) {
      case "moveToArea":
        return yield* projectMoveArea(store, packet);
      case "initUserData": {
        const decoded = decodePlayer(packetData(packet));
        if (Option.isSome(decoded))
          yield* store.world.putPlayer(toPlayer(decoded.value));
        return [];
      }
      case "uotls": {
        if (packet.wireType !== "json") return [];
        const decoded = decodePlayerUpdate(packetData(packet));
        if (Option.isNone(decoded)) return [];
        const current = yield* store.world.getPlayer(decoded.value.unm);
        if (current === null) return [];
        const result = yield* store.world.patchPlayer(
          current.username,
          playerPatch(decoded.value.o, current.position),
        );
        return result?.becameDead
          ? [
              {
                type: "player-death",
                entityId: result.player.entityId,
                username: result.player.username,
              },
            ]
          : [];
      }
      case "mtls": {
        if (packet.wireType !== "json") return [];
        const decoded = decodeMonsterUpdate(packetData(packet));
        if (Option.isNone(decoded)) return [];
        const result = yield* store.world.patchMonster(
          decoded.value.id,
          monsterPatch(decoded.value.o),
        );
        return result?.becameDead
          ? [{ type: "monster-death", monsterMapId: decoded.value.id }]
          : [];
      }
      case "moveToCell": {
        if (packet.direction !== "client") return [];
        const current = yield* store.world.getMe;
        if (current === null) return [];
        const cell = packet.params[4];
        const pad = packet.params[5];
        if (cell === undefined) return [];
        yield* store.world.patchPlayer(current.username, {
          cell,
          ...(pad === undefined ? {} : { pad }),
        });
        return [];
      }
      case "clearAuras": {
        const current = yield* store.world.getMe;
        if (current !== null)
          yield* store.world.clearAuras("player", current.entityId);
        return [];
      }
      default:
        return [];
    }
  });
