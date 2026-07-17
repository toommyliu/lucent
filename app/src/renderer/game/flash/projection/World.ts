import { Effect, Option, Schema } from "effect";
import { EntityState } from "@lucent/game";

import type { BridgeService } from "../bridge/Bridge";
import { PositiveWireInt, UnknownRecord, WireInt } from "../contract/Coercion";
import type { Event } from "../contract/Event";
import {
  ignoreDiagnostic,
  type DiagnosticReporter,
} from "../contract/Diagnostic";
import type { ClientPacket, ExtensionPacket } from "../contract/Packet";
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
  monBranch: Schema.optionalKey(Schema.Array(Schema.Unknown)),
  mondef: Schema.optionalKey(Schema.Array(Schema.Unknown)),
  monmap: Schema.optionalKey(Schema.Array(Schema.Unknown)),
  uoBranch: Schema.optionalKey(Schema.Array(Schema.Unknown)),
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
const InitUser = Schema.Struct({
  data: UnknownRecord,
  uid: Schema.optionalKey(PositiveWireInt),
});
const PlayerBaselines = Schema.Struct({ a: Schema.Array(Schema.Unknown) });
const GoldExperience = Schema.Struct({
  id: PositiveWireInt,
  typ: Schema.String,
});
const NullablePlayerData = Schema.NullOr(UnknownRecord);
const decodeMoveArea = Schema.decodeUnknownOption(MoveArea);
const decodeRecord = Schema.decodeUnknownOption(UnknownRecord);
const decodePlayer = Schema.decodeUnknownOption(PlayerPayload);
const decodeMonster = Schema.decodeUnknownOption(MonsterPayload);
const decodePlayerUpdate = Schema.decodeUnknownOption(PlayerUpdate);
const decodeMonsterUpdate = Schema.decodeUnknownOption(MonsterUpdate);
const decodeZone = Schema.decodeUnknownOption(Zone);
const decodeInitUser = Schema.decodeUnknownOption(InitUser);
const decodePlayerBaselines = Schema.decodeUnknownOption(PlayerBaselines);
const decodeGoldExperience = Schema.decodeUnknownOption(GoldExperience);
const decodeInt = Schema.decodeUnknownOption(WireInt);
const decodePositiveInt = Schema.decodeUnknownOption(PositiveWireInt);
const decodeString = Schema.decodeUnknownOption(Schema.String);

const localUserId = (store: Store, bridge: BridgeService | undefined) =>
  store.world.getSelfEntityId.pipe(
    Effect.flatMap((cached) => {
      if (cached !== null) return Effect.succeed(Option.some(cached));
      return bridge === undefined
        ? Effect.succeed(Option.none<number>())
        : bridge.invoke("player.getUserId", undefined, PositiveWireInt);
    }),
  );

const getOrHydrateSelf = (
  store: Store,
  bridge: BridgeService | undefined,
  diagnose: DiagnosticReporter,
) =>
  Effect.gen(function* () {
    const projected = yield* store.world.getMe;
    if (projected !== null) return projected;
    if (bridge === undefined) return null;

    const userId = yield* localUserId(store, bridge);
    if (Option.isNone(userId)) return null;

    const existing = yield* store.world.getPlayer(userId.value);
    if (existing !== null) {
      yield* store.world.setSelf(existing.username);
      return existing;
    }

    const data = yield* bridge.invoke(
      "player.getData",
      undefined,
      NullablePlayerData,
    );
    if (Option.isNone(data) || data.value === null) return null;

    const decoded = decodePlayer({ ...data.value, entID: userId.value });
    if (Option.isNone(decoded)) {
      yield* diagnose(
        "world:self-hydration",
        new Error("Malformed local player bridge data"),
        [data.value, userId.value],
      );
      return null;
    }

    const player = yield* store.world.putPlayer(toPlayer(decoded.value));
    yield* store.world.setSelf(player.username);
    return player;
  });

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

const decodeInitializedPlayer = (value: unknown) =>
  Option.flatMap(decodeInitUser(value), (initialized) =>
    decodePlayer({
      ...initialized.data,
      entID: initialized.uid ?? initialized.data["entID"],
    }),
  );

const decodeStringMonsterUpdate = (packet: ExtensionPacket) => {
  const data = packet.data;
  if (!Array.isArray(data)) return Option.none<typeof MonsterUpdate.Type>();
  const patch = data[3];
  return typeof patch === "string"
    ? decodeMonsterUpdate({ id: data[2], o: parseCsv(patch) })
    : Option.none();
};

const decodeStringPlayerUpdate = (packet: ExtensionPacket) => {
  const data = packet.data;
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
  packet: ExtensionPacket,
  diagnose: DiagnosticReporter,
  bridge: BridgeService | undefined,
) =>
  Effect.gen(function* () {
    const decoded = decodeMoveArea(packet.data);
    if (Option.isNone(decoded)) {
      yield* diagnose(
        "world:moveToArea",
        new Error("Malformed area baseline"),
        [packet.data],
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

    const invalidMonsterEntries: unknown[] = [];
    const definitions = new Map<number, Record<string, unknown>>();
    for (const value of decoded.value.mondef ?? []) {
      const record = decodeRecord(value);
      if (Option.isNone(record)) {
        invalidMonsterEntries.push(value);
        continue;
      }
      const definition = record.value;
      const id = decodePositiveInt(definition["MonID"]);
      if (Option.isSome(id)) definitions.set(id.value, definition);
    }
    const cells = new Map<number, string>();
    for (const value of decoded.value.monmap ?? []) {
      const record = decodeRecord(value);
      if (Option.isNone(record)) {
        invalidMonsterEntries.push(value);
        continue;
      }
      const placement = record.value;
      const id = decodePositiveInt(placement["MonMapID"]);
      const cell = decodeString(placement["strFrame"]);
      if (Option.isSome(id) && Option.isSome(cell)) {
        cells.set(id.value, cell.value);
      }
    }
    const monsters: ReturnType<typeof toMonster>[] = [];
    for (const value of decoded.value.monBranch ?? []) {
      const record = decodeRecord(value);
      if (Option.isNone(record)) {
        invalidMonsterEntries.push(value);
        continue;
      }
      const branch = record.value;
      const monsterId = decodePositiveInt(branch["MonID"]);
      const monsterMapId = decodePositiveInt(branch["MonMapID"]);
      if (Option.isNone(monsterId) || Option.isNone(monsterMapId)) {
        invalidMonsterEntries.push(value);
        continue;
      }
      const decodedMonster = decodeMonster({
        ...definitions.get(monsterId.value),
        ...branch,
        ...(cells.get(monsterMapId.value) === undefined
          ? {}
          : { strFrame: cells.get(monsterMapId.value) }),
      });
      if (Option.isNone(decodedMonster)) {
        invalidMonsterEntries.push(value);
      } else {
        monsters.push(toMonster(decodedMonster.value));
      }
    }

    if (invalidMonsterEntries.length > 0) {
      yield* diagnose(
        "world:moveToArea:monster-entries",
        new Error(
          `Ignored ${invalidMonsterEntries.length} malformed monster entries`,
        ),
        invalidMonsterEntries,
      );
    }

    const invalidPlayerEntries: unknown[] = [];
    const players: ReturnType<typeof toPlayer>[] = [];
    for (const value of decoded.value.uoBranch ?? []) {
      const player = decodePlayer(value);
      if (Option.isNone(player)) {
        invalidPlayerEntries.push(value);
      } else {
        players.push(toPlayer(player.value));
      }
    }

    if (invalidPlayerEntries.length > 0) {
      yield* diagnose(
        "world:moveToArea:player-entries",
        new Error(
          `Ignored ${invalidPlayerEntries.length} malformed player entries`,
        ),
        invalidPlayerEntries,
      );
    }

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
    const userId = yield* localUserId(store, bridge);
    const self = players.find(
      (player) =>
        (Option.isSome(userId) && player.entityId === userId.value) ||
        player.username.localeCompare(previousAuth.username, undefined, {
          sensitivity: "accent",
        }) === 0,
    );
    if (self !== undefined) yield* store.world.setSelf(self.username);
    return [{ type: "join-map", map }] satisfies readonly Event[];
  });

export const projectClientWorld = Effect.fn("projectClientWorld")(function* (
  store: Store,
  packet: ClientPacket,
  diagnose: DiagnosticReporter = ignoreDiagnostic,
  bridge?: BridgeService,
): Effect.fn.Return<readonly Event[]> {
  switch (packet.command) {
    case "moveToCell": {
      const current = yield* getOrHydrateSelf(store, bridge, diagnose);
      if (current === null) {
        yield* diagnose(
          "world:client-movement-without-self",
          new Error("Cannot project cell movement without a local player"),
          [packet.params],
        );
        return [];
      }
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
      const current = yield* getOrHydrateSelf(store, bridge, diagnose);
      const x = decodeInt(packet.params[4]);
      const y = decodeInt(packet.params[5]);
      if (current === null) {
        yield* diagnose(
          "world:client-movement-without-self",
          new Error("Cannot project position movement without a local player"),
          [packet.params],
        );
        return [];
      }
      if (Option.isNone(x) || Option.isNone(y)) return [];
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
    default:
      return [];
  }
});

export const projectExtensionWorld = (
  store: Store,
  packet: ExtensionPacket,
  diagnose: DiagnosticReporter = ignoreDiagnostic,
  bridge?: BridgeService,
): Effect.Effect<readonly Event[]> =>
  Effect.gen(function* () {
    switch (packet.command) {
      case "moveToArea":
        return yield* projectMoveArea(store, packet, diagnose, bridge);
      case "initUserData":
      case "initUserDatas": {
        const data = packet.data;
        const baselines =
          packet.command === "initUserData"
            ? Option.some([data] as readonly unknown[])
            : Option.map(decodePlayerBaselines(data), (payload) => payload.a);
        if (Option.isNone(baselines)) {
          yield* diagnose(
            `world:${packet.command}`,
            new Error("Malformed player baseline"),
            [data],
          );
          return [];
        }

        const auth = yield* store.auth.get;
        const userId = yield* localUserId(store, bridge);
        for (const baseline of baselines.value) {
          const decoded = decodeInitializedPlayer(baseline);
          if (Option.isNone(decoded)) {
            yield* diagnose(
              `world:${packet.command}`,
              new Error("Malformed player baseline entry"),
              [baseline],
            );
            continue;
          }
          const player = yield* store.world.putPlayer(toPlayer(decoded.value));
          if (
            (Option.isSome(userId) && player.entityId === userId.value) ||
            player.username.localeCompare(auth.username, undefined, {
              sensitivity: "accent",
            }) === 0
          ) {
            yield* store.world.setSelf(player.username);
          }
        }
        return [];
      }
      case "exitArea": {
        const data = packet.data;
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
            : decodePlayerUpdate(packet.data);
        if (Option.isNone(decoded)) {
          yield* diagnose("world:uotls", new Error("Malformed player update"), [
            packet.data,
          ]);
          return [];
        }
        const current = yield* store.world.getPlayer(decoded.value.unm);
        if (current === null) {
          yield* diagnose(
            "world:unknown-player-update",
            new Error("Ignored update for unknown player"),
            [decoded.value.unm, packet.data],
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
            : decodeMonsterUpdate(packet.data);
        if (Option.isNone(decoded)) {
          yield* diagnose("world:mtls", new Error("Malformed monster update"), [
            packet.data,
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
            [decoded.value.id, packet.data],
          );
          return [];
        }
        return result.becameDead
          ? [{ type: "monster-death", monsterMapId: decoded.value.id }]
          : [];
      }
      case "mtcid": {
        yield* Effect.log("[world] mtcid packet received", { packet });
        if (bridge === undefined) return [];
        const current = yield* getOrHydrateSelf(store, bridge, diagnose);
        if (current === null) {
          yield* diagnose(
            "world:client-movement-without-self",
            new Error("Cannot project cell transition without a local player"),
            [packet.data],
          );
          return [];
        }

        const [cell, pad] = yield* Effect.all([
          bridge.invoke("player.getCell", undefined, Schema.String),
          bridge.invoke("player.getPad", undefined, Schema.String),
        ]);
        if (Option.isNone(cell) || Option.isNone(pad)) return [];

        yield* store.world.patchPlayer(current.username, {
          cell: cell.value,
          pad: pad.value,
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
        const decoded = decodeZone(packet.data);
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
        const data = packet.data;
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
        const decoded = decodeGoldExperience(packet.data);
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
