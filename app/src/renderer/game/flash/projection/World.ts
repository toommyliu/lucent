import { Effect, Option, Schema } from "effect";
import { EntityState } from "@lucent/game";

import { PositiveWireInt, UnknownRecord, WireInt } from "../contract/Coercion";
import type { Event } from "../contract/Event";
import {
  ignoreDiagnostic,
  type DiagnosticReporter,
} from "../contract/Diagnostic";
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
const Zone = Schema.Struct({
  args: Schema.Struct({ zoneSet: Schema.optionalKey(Schema.String) }),
});
const PlayerBaselines = Schema.Struct({
  a: Schema.Array(PlayerPayload),
});
const GoldExperience = Schema.Struct({
  id: PositiveWireInt,
  typ: Schema.String,
});
const decodeMoveArea = Schema.decodeUnknownOption(MoveArea);
const decodePlayer = Schema.decodeUnknownOption(PlayerPayload);
const decodeMonster = Schema.decodeUnknownOption(MonsterPayload);
const decodePlayerUpdate = Schema.decodeUnknownOption(PlayerUpdate);
const decodeMonsterUpdate = Schema.decodeUnknownOption(MonsterUpdate);
const decodeZone = Schema.decodeUnknownOption(Zone);
const decodePlayerBaselines = Schema.decodeUnknownOption(PlayerBaselines);
const decodeGoldExperience = Schema.decodeUnknownOption(GoldExperience);
const decodeInt = Schema.decodeUnknownOption(WireInt);
const decodePositiveInt = Schema.decodeUnknownOption(PositiveWireInt);
const decodeString = Schema.decodeUnknownOption(Schema.String);

const parseCsv = (value: string): Record<string, string> => {
  const result: Record<string, string> = {};
  for (const token of value.split(",")) {
    const separator = token.indexOf(":");
    if (separator > 0) {
      result[token.slice(0, separator)] = token.slice(separator + 1);
    }
  }
  return result;
};

const decodeStringMonsterUpdate = (packet: Packet) => {
  const data = packetData(packet);
  if (!Array.isArray(data)) return Option.none<typeof MonsterUpdate.Type>();
  const patch = data[3];
  return typeof patch === "string"
    ? decodeMonsterUpdate({ id: data[2], o: parseCsv(patch) })
    : Option.none();
};

const decodeStringPlayerUpdate = (packet: Packet) => {
  const data = packetData(packet);
  if (!Array.isArray(data)) return Option.none<typeof PlayerUpdate.Type>();
  const username = data[2];
  const patch = data[3];
  if (typeof username !== "string" || typeof patch !== "string") {
    return Option.none<typeof PlayerUpdate.Type>();
  }
  const parsed = parseCsv(patch);
  return decodePlayerUpdate({
    o: {
      ...parsed,
      ...(parsed["px"] === undefined ? {} : { tx: parsed["px"] }),
      ...(parsed["py"] === undefined ? {} : { ty: parsed["py"] }),
    },
    unm: username,
  });
};

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

const projectMoveArea = (
  store: Store,
  packet: Packet,
  diagnose: DiagnosticReporter,
) =>
  Effect.gen(function* () {
    const decoded = decodeMoveArea(packetData(packet));
    if (Option.isNone(decoded)) {
      yield* diagnose(
        "world:moveToArea",
        new Error("Malformed area baseline"),
        ["[payload omitted]"],
      );
      return [];
    }
    const previousAuth = yield* store.auth.get;
    const previousSelf = yield* store.world.getMe;
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

    if (
      previousSelf !== null &&
      previousSelf.username.localeCompare(previousAuth.username, undefined, {
        sensitivity: "accent",
      }) === 0 &&
      !players.some(
        (player) =>
          player.username.localeCompare(previousSelf.username, undefined, {
            sensitivity: "accent",
          }) === 0,
      )
    ) {
      players.push(previousSelf);
    }

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
  diagnose: DiagnosticReporter = ignoreDiagnostic,
): Effect.Effect<readonly Event[]> =>
  Effect.gen(function* () {
    switch (packet.command) {
      case "moveToArea":
        return yield* projectMoveArea(store, packet, diagnose);
      case "initUserData":
      case "initUserDatas": {
        const players =
          packet.command === "initUserData"
            ? Option.map(decodePlayer(packetData(packet)), (player) => [player])
            : Option.map(
                decodePlayerBaselines(packetData(packet)),
                (payload) => payload.a,
              );
        if (Option.isSome(players)) {
          for (const player of players.value) {
            yield* store.world.putPlayer(toPlayer(player));
          }
        } else {
          yield* diagnose(
            `world:${packet.command}`,
            new Error("Malformed player baseline"),
            ["[payload omitted]"],
          );
        }
        return [];
      }
      case "exitArea": {
        const data = packetData(packet);
        const username = Array.isArray(data)
          ? decodeString(data[3])
          : Option.none();
        if (Option.isSome(username)) {
          yield* store.world.removePlayer(username.value);
        }
        return [];
      }
      case "uotls": {
        const decoded =
          packet.wireType === "str"
            ? decodeStringPlayerUpdate(packet)
            : decodePlayerUpdate(packetData(packet));
        if (Option.isNone(decoded)) {
          yield* diagnose("world:uotls", new Error("Malformed player update"), [
            "[payload omitted]",
          ]);
          return [];
        }
        const current = yield* store.world.getPlayer(decoded.value.unm);
        if (current === null) {
          yield* diagnose(
            "world:unknown-player-update",
            new Error("Ignored update for unknown player"),
            [decoded.value.unm],
          );
          return [];
        }
        const result = yield* store.world.patchPlayer(
          current.username,
          playerPatch(decoded.value.o, current.position),
        );
        if (result === null) return [];
        const events: Event[] = [];
        if (
          decoded.value.o.strFrame !== undefined ||
          decoded.value.o.strPad !== undefined ||
          decoded.value.o.tx !== undefined ||
          decoded.value.o.ty !== undefined
        ) {
          events.push({
            type: "player-location",
            entityId: result.player.entityId,
            username: result.player.username,
          });
        }
        if (result.becameDead) {
          events.push({
            type: "player-death",
            entityId: result.player.entityId,
            username: result.player.username,
          });
        }
        return events;
      }
      case "mtls": {
        const decoded =
          packet.wireType === "str"
            ? decodeStringMonsterUpdate(packet)
            : decodeMonsterUpdate(packetData(packet));
        if (Option.isNone(decoded)) {
          yield* diagnose("world:mtls", new Error("Malformed monster update"), [
            "[payload omitted]",
          ]);
          return [];
        }
        const result = yield* store.world.patchMonster(
          decoded.value.id,
          monsterPatch(decoded.value.o),
        );
        if (result === null) {
          yield* diagnose(
            "world:unknown-monster-update",
            new Error("Ignored update for unknown monster"),
            [decoded.value.id],
          );
          return [];
        }
        return result.becameDead
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
        return [
          {
            type: "player-location",
            entityId: current.entityId,
            username: current.username,
          },
        ];
      }
      case "mv": {
        if (packet.direction !== "client") return [];
        const current = yield* store.world.getMe;
        const x = decodeInt(packet.params[4]);
        const y = decodeInt(packet.params[5]);
        if (current === null || Option.isNone(x) || Option.isNone(y)) return [];
        yield* store.world.patchPlayer(current.username, {
          position: { x: x.value, y: y.value },
        });
        return [
          {
            type: "player-location",
            entityId: current.entityId,
            username: current.username,
          },
        ];
      }
      case "clearAuras": {
        const current = yield* store.world.getMe;
        if (current !== null)
          yield* store.world.clearAuras("player", current.entityId);
        return [];
      }
      case "event": {
        const decoded = decodeZone(packetData(packet));
        if (Option.isNone(decoded)) return [];
        const map = yield* store.world.getMap;
        return [
          {
            type: "zone",
            map: map.name,
            zone: decoded.value.args.zoneSet ?? "",
          },
        ];
      }
      case "respawnMon": {
        const data = packetData(packet);
        const ids =
          Array.isArray(data) && typeof data[2] === "string"
            ? data[2].split(",").flatMap((value) => {
                const id = decodePositiveInt(value);
                return Option.isSome(id) ? [id.value] : [];
              })
            : [];
        const events: Event[] = [];
        for (const id of ids) {
          const monster = yield* store.world.getMonster(id);
          if (monster === null) {
            yield* diagnose(
              "world:unknown-monster-respawn",
              new Error("Ignored respawn for unknown monster"),
              [id],
            );
            continue;
          }
          yield* store.world.patchMonster(id, {
            hp: monster.maxHp,
            mp: monster.maxMp,
            state: EntityState.Idle,
          });
          events.push({ type: "monster-respawn", monsterMapId: id });
        }
        return events;
      }
      case "addGoldExp": {
        const decoded = decodeGoldExperience(packetData(packet));
        if (Option.isNone(decoded) || decoded.value.typ !== "m") return [];
        const result = yield* store.world.patchMonster(decoded.value.id, {
          hp: 0,
          mp: 0,
          state: EntityState.Dead,
        });
        return result?.becameDead
          ? [{ type: "monster-death", monsterMapId: decoded.value.id }]
          : [];
      }
      default:
        return [];
    }
  });
