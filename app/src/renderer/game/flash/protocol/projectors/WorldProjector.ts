import { Effect } from "effect";

import { EntityState, LiveMonster, LivePlayer } from "@lucent/game";
import type { Player, PlayerData } from "@lucent/game";
import type { AuthApiShape } from "../../api/Auth";
import type {
  FlashPacket,
  FlashProjectionEvent,
  MapInfo,
  Position,
} from "../../Types";
import {
  asArray,
  asInt,
  asPositiveInt,
  asRecord,
  asString,
  decodeMonsterModel,
  decodePlayerModel,
  equalsIgnoreCase,
} from "../../payload";
import type { WorldStateShape } from "../../state/World";
import { parseMapNameRoom } from "../../state/World";
import {
  decodeMonsterUpdate,
  decodeRespawnMonsterIds,
  decodeStringMonsterUpdate,
  decodeStringPlayerUpdate,
  decodePlayerUpdate,
  packetData,
  type DecodedLocationPatch,
  type DecodedPlayerUpdate,
} from "../ProjectorDecoders";
import type { TargetRelations } from "./TargetRelations";

const clonePlayer = (player: Player): LivePlayer =>
  new LivePlayer({
    afk: player.afk,
    cell: player.cell,
    entityId: player.entityId,
    entityType: player.entityType,
    hp: player.hp,
    level: player.level,
    maxHp: player.maxHp,
    maxMp: player.maxMp,
    mp: player.mp,
    name: player.name,
    pad: player.pad,
    position: { ...player.position },
    state: player.state,
    username: player.username,
  });

const hasPlayerProjectionIdentity = (
  value: Record<string, unknown>,
): boolean => {
  const uoName = asString(value["uoName"])?.trim();
  return (
    asPositiveInt(value["entID"]) !== undefined &&
    uoName !== undefined &&
    uoName !== ""
  );
};

const playerIdentityFromInit = (value: unknown) => {
  const root = asRecord(value);
  const data = asRecord(root?.["data"]);
  const username = asString(data?.["strUsername"])?.trim();
  const entityId =
    asPositiveInt(root?.["uid"]) ?? asPositiveInt(data?.["entID"]);
  return root !== null &&
    data !== null &&
    username !== undefined &&
    username !== "" &&
    entityId !== undefined
    ? { entityId, username }
    : null;
};

const withLocationPosition = (
  patch: Partial<PlayerData>,
  location: DecodedLocationPatch | undefined,
  current: Player,
): Partial<PlayerData> => {
  if (location?.x === undefined && location?.y === undefined) return patch;
  const position: Position = {
    x: location.x ?? current.position.x,
    y: location.y ?? current.position.y,
  };
  return { ...patch, position };
};

const playerDeathEvent = (
  packet: FlashPacket,
  death: {
    readonly cell: string;
    readonly entityId: number;
    readonly hp: number;
    readonly isSelf: boolean;
    readonly pad: string;
    readonly state: EntityState;
    readonly username: string;
  },
): FlashProjectionEvent => ({
  kind: "projection",
  packet,
  payload: death,
  type: "playerDeath",
});

const monsterDeathEvent = (
  packet: FlashPacket,
  monsterMapId: number,
): FlashProjectionEvent => ({
  kind: "projection",
  packet,
  payload: { monsterMapId },
  type: "monsterDeath",
});

const projectPlayerUpdate = (
  packet: FlashPacket,
  decoded: DecodedPlayerUpdate,
  world: WorldStateShape,
  relations: TargetRelations,
) =>
  Effect.gen(function* () {
    let current = yield* world.getPlayer(decoded.username);
    if (current === null) {
      const raw = asRecord(packetData(packet));
      const rawUpdate =
        packet.wireType === "json" ? asRecord(raw?.["o"]) : null;
      const candidate =
        rawUpdate === null
          ? null
          : { ...rawUpdate, strUsername: decoded.username };
      if (candidate === null || !hasPlayerProjectionIdentity(candidate)) {
        return [];
      }

      const added = decodePlayerModel(candidate);
      if (added === null) return [];
      yield* world.addPlayer(added);
      current = yield* world.getPlayer(decoded.username);
      if (current === null) return [];
    }

    const result = yield* world.patchPlayer(
      decoded.username,
      withLocationPosition(decoded.patch, decoded.location, current),
    );
    if (result === null) return [];

    const entity = result.entity;
    const self = yield* world.getMe();
    const isSelf =
      self !== null && equalsIgnoreCase(self.username, entity.username);
    const events: FlashProjectionEvent[] = [];
    if (decoded.afk !== undefined) {
      events.push({
        kind: "projection",
        packet,
        payload: {
          afk: decoded.afk,
          entityId: entity.entityId,
          isSelf,
          username: entity.username,
        },
        type: "playerAfk",
      });
    }
    if (decoded.location !== undefined) {
      events.push({
        kind: "projection",
        packet,
        payload: {
          ...(decoded.location.cell === undefined ? {} : { cell: entity.cell }),
          entityId: entity.entityId,
          isSelf,
          ...(decoded.location.pad === undefined ? {} : { pad: entity.pad }),
          ...(decoded.location.x === undefined &&
          decoded.location.y === undefined
            ? {}
            : { position: { ...entity.position } }),
          username: entity.username,
        },
        type: "playerLocation",
      });
    }
    if (result.becameDead) {
      relations.remove({ id: entity.entityId, type: "p" });
      events.push(
        playerDeathEvent(packet, {
          cell: entity.cell,
          entityId: entity.entityId,
          hp: entity.hp,
          isSelf,
          pad: entity.pad,
          state: entity.state,
          username: entity.username,
        }),
      );
    } else if (
      decoded.patch.state !== undefined &&
      entity.state !== EntityState.InCombat
    ) {
      relations.remove({ id: entity.entityId, type: "p" });
    }
    return events;
  });

const projectMonsterPatch = (
  packet: FlashPacket,
  update: ReturnType<typeof decodeMonsterUpdate>,
  world: WorldStateShape,
  relations: TargetRelations,
) =>
  Effect.gen(function* () {
    if (update === null) return [];
    const result = yield* world.patchMonster(update.monsterMapId, update.patch);
    if (result === null) return [];
    if (
      update.patch.state !== undefined &&
      result.entity.state !== EntityState.InCombat
    ) {
      relations.remove({ id: result.entity.monsterMapId, type: "m" });
    }
    return result.becameDead
      ? [monsterDeathEvent(packet, result.entity.monsterMapId)]
      : [];
  });

const projectMoveToArea = (
  packet: FlashPacket,
  auth: AuthApiShape,
  world: WorldStateShape,
  relations: TargetRelations,
) =>
  Effect.gen(function* () {
    const payload = asRecord(packetData(packet));
    if (payload === null) return [];

    const currentMap = yield* world.getMap();
    const map: MapInfo = {
      ...currentMap,
      ...parseMapNameRoom(asString(payload["areaName"])),
      ...(asPositiveInt(payload["areaId"]) === undefined
        ? {}
        : { id: asPositiveInt(payload["areaId"])! }),
    };

    const definitions = new Map<number, Record<string, unknown>>();
    for (const value of asArray(payload["mondef"])) {
      const definition = asRecord(value);
      const monsterId = asPositiveInt(definition?.["MonID"]);
      if (definition !== null && monsterId !== undefined) {
        definitions.set(monsterId, definition);
      }
    }

    const cells = new Map<number, string>();
    for (const value of asArray(payload["monmap"])) {
      const record = asRecord(value);
      const monsterMapId = asPositiveInt(record?.["MonMapID"]);
      const cell = asString(record?.["strFrame"]);
      if (monsterMapId !== undefined && cell !== undefined) {
        cells.set(monsterMapId, cell);
      }
    }

    const monsters: LiveMonster[] = [];
    for (const value of asArray(payload["monBranch"])) {
      const raw = asRecord(value);
      const monsterId = asPositiveInt(raw?.["MonID"]);
      const monsterMapId = asPositiveInt(raw?.["MonMapID"]);
      if (
        raw === null ||
        monsterId === undefined ||
        monsterMapId === undefined
      ) {
        continue;
      }
      const cell = cells.get(monsterMapId);
      const monster = decodeMonsterModel(
        {
          ...definitions.get(monsterId),
          ...raw,
          ...(cell === undefined ? {} : { strFrame: cell }),
        },
        { monsterId, monsterMapId },
      );
      if (monster !== null) monsters.push(monster);
    }

    const previousSelf = yield* world.getMe();
    const authUsername = yield* auth
      .getUsername()
      .pipe(Effect.orElseSucceed(() => ""));
    const players = asArray(payload["uoBranch"])
      .map(decodePlayerModel)
      .filter((player): player is LivePlayer => player !== null);

    const authenticatedSelf =
      authUsername === ""
        ? undefined
        : players.find((player) =>
            equalsIgnoreCase(player.username, authUsername),
          );
    const retainedSelf =
      previousSelf === null ||
      (authUsername !== "" &&
        !equalsIgnoreCase(previousSelf.username, authUsername))
        ? undefined
        : previousSelf;
    const previousSelfInArea =
      retainedSelf === undefined
        ? undefined
        : players.find((player) =>
            equalsIgnoreCase(player.username, retainedSelf.username),
          );
    let selfUsername =
      authenticatedSelf?.username ?? previousSelfInArea?.username;
    if (selfUsername === undefined && retainedSelf !== undefined) {
      players.push(clonePlayer(retainedSelf));
      selfUsername = retainedSelf.username;
    }
    if (selfUsername === undefined && authUsername !== "") {
      selfUsername = authUsername;
    }

    // moveToArea is authoritative even when the client reuses the room identifier.
    yield* world.replaceArea({ map, monsters, players, selfUsername });
    relations.reset();
    return [
      {
        kind: "projection",
        packet,
        payload: { ...map },
        type: "joinMap",
      } satisfies FlashProjectionEvent,
    ];
  });

const projectInitUser = (
  packet: FlashPacket,
  auth: AuthApiShape,
  world: WorldStateShape,
) =>
  Effect.gen(function* () {
    const identities =
      packet.command === "initUserData"
        ? [playerIdentityFromInit(packetData(packet))]
        : asArray(asRecord(packetData(packet))?.["a"]).map(
            playerIdentityFromInit,
          );
    const authUsername = yield* auth
      .getUsername()
      .pipe(Effect.orElseSucceed(() => ""));
    const previousSelf = yield* world.getMe();

    for (const identity of identities) {
      if (identity === null) continue;
      // initUserData(s) may carry identity only; do not fabricate live stats.
      yield* world.registerPlayerIdentity(identity.username, identity.entityId);
      if (
        (authUsername !== "" &&
          equalsIgnoreCase(authUsername, identity.username)) ||
        (previousSelf !== null &&
          equalsIgnoreCase(previousSelf.username, identity.username))
      ) {
        yield* world.setSelf(identity.username);
      }
    }
    return [];
  });

const projectJsonUotls = (
  packet: FlashPacket,
  world: WorldStateShape,
  relations: TargetRelations,
) => {
  const payload = asRecord(packetData(packet));
  const username = asString(payload?.["unm"]);
  const decoded =
    username === undefined
      ? null
      : decodePlayerUpdate(username, payload?.["o"]);
  return decoded === null
    ? Effect.succeed([])
    : projectPlayerUpdate(packet, decoded, world, relations);
};

const projectClientLocation = (packet: FlashPacket, world: WorldStateShape) =>
  Effect.gen(function* () {
    const self = yield* world.getMe();
    const parts = packetData(packet);
    if (self === null || !Array.isArray(parts)) return [];

    const location: DecodedLocationPatch =
      packet.command === "moveToCell"
        ? {
            ...(asString(parts[4]) === undefined
              ? {}
              : { cell: asString(parts[4])! }),
            ...(asString(parts[5]) === undefined
              ? {}
              : { pad: asString(parts[5])! }),
          }
        : {
            ...(asInt(parts[4]) === undefined ? {} : { x: asInt(parts[4])! }),
            ...(asInt(parts[5]) === undefined ? {} : { y: asInt(parts[5])! }),
          };
    if (
      location.cell === undefined &&
      location.pad === undefined &&
      location.x === undefined &&
      location.y === undefined
    ) {
      return [];
    }

    const patch: Partial<PlayerData> = {
      ...(location.cell === undefined ? {} : { cell: location.cell }),
      ...(location.pad === undefined ? {} : { pad: location.pad }),
      ...(location.x === undefined && location.y === undefined
        ? {}
        : {
            position: {
              x: location.x ?? self.position.x,
              y: location.y ?? self.position.y,
            },
          }),
    };
    const result = yield* world.patchPlayer(self.username, patch);
    if (result === null) return [];
    return [
      {
        kind: "projection",
        packet,
        payload: {
          ...(location.cell === undefined ? {} : { cell: result.entity.cell }),
          entityId: result.entity.entityId,
          isSelf: true,
          ...(location.pad === undefined ? {} : { pad: result.entity.pad }),
          ...(location.x === undefined && location.y === undefined
            ? {}
            : { position: { ...result.entity.position } }),
          username: result.entity.username,
        },
        type: "playerLocation",
      } satisfies FlashProjectionEvent,
    ];
  });

export const projectWorldPacket = (
  packet: FlashPacket,
  auth: AuthApiShape,
  world: WorldStateShape,
  relations: TargetRelations,
): Effect.Effect<readonly FlashProjectionEvent[]> => {
  switch (packet.command) {
    case "moveToArea":
      return projectMoveToArea(packet, auth, world, relations);
    case "event":
      return Effect.gen(function* () {
        const args = asRecord(asRecord(packetData(packet))?.["args"]);
        const map = yield* world.getMap();
        return [
          {
            kind: "projection",
            packet,
            payload: { map: map.name, zone: asString(args?.["zoneSet"]) ?? "" },
            type: "zone",
          } satisfies FlashProjectionEvent,
        ];
      });
    case "initUserData":
    case "initUserDatas":
      return projectInitUser(packet, auth, world);
    case "exitArea":
      return Effect.gen(function* () {
        const data = packetData(packet);
        const username = Array.isArray(data) ? asString(data[3]) : undefined;
        if (username !== undefined) {
          const removed = yield* world.removePlayer(username);
          if (removed !== null) {
            relations.remove({ id: removed.entityId, type: "p" });
          }
        }
        return [];
      });
    case "uotls":
      if (packet.wireType === "str") {
        const decoded = decodeStringPlayerUpdate(packet);
        return decoded === null
          ? Effect.succeed([])
          : projectPlayerUpdate(packet, decoded, world, relations);
      }
      return projectJsonUotls(packet, world, relations);
    case "mtls": {
      const update =
        packet.wireType === "str"
          ? decodeStringMonsterUpdate(packet)
          : decodeMonsterUpdate(
              asRecord(packetData(packet))?.["id"],
              asRecord(packetData(packet))?.["o"],
            );
      return projectMonsterPatch(packet, update, world, relations);
    }
    case "clearAuras":
      return Effect.gen(function* () {
        const self = yield* world.getMe();
        if (self !== null) yield* world.clearAuras("player", self.entityId);
        return [];
      });
    case "respawnMon":
      return Effect.gen(function* () {
        for (const monsterMapId of decodeRespawnMonsterIds(packet)) {
          if ((yield* world.respawnMonster(monsterMapId)) !== null) {
            relations.remove({ id: monsterMapId, type: "m" });
          }
        }
        return [];
      });
    case "addGoldExp":
      return Effect.gen(function* () {
        const payload = asRecord(packetData(packet));
        const monsterMapId = asPositiveInt(payload?.["id"]);
        if (asString(payload?.["typ"]) !== "m" || monsterMapId === undefined) {
          return [];
        }
        return yield* projectMonsterPatch(
          packet,
          {
            monsterMapId,
            patch: { hp: 0, mp: 0, state: EntityState.Dead },
          },
          world,
          relations,
        );
      });
    case "gar":
      return relations.applyClientGar(packet, world).pipe(Effect.as([]));
    case "moveToCell":
    case "mv":
      return projectClientLocation(packet, world);
    default:
      return Effect.succeed([]);
  }
};
