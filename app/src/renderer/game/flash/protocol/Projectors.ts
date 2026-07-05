import { Effect, Layer } from "effect";

import type {
  FlashPacket,
  MonsterRecord,
  PacketSelector,
  PlayerRecord,
  Position,
} from "../Types";
import { AuthApi, type AuthApiShape } from "../api/Auth";
import {
  asArray,
  asBoolean,
  asInt,
  asNumber,
  asPositiveInt,
  asRecord,
  asString,
  equalsIgnoreCase,
  normalizeAuraRecord,
  normalizeMonsterRecord,
  normalizePlayerRecord,
} from "../payload";
import { DropsState } from "../state/Drops";
import type { DropsStateShape } from "../state/Drops";
import { ItemsState } from "../state/Items";
import type { ItemsStateShape } from "../state/Items";
import { QuestsState } from "../state/Quests";
import type { QuestsStateShape } from "../state/Quests";
import { ShopsState } from "../state/Shops";
import type { ShopsStateShape } from "../state/Shops";
import { WorldState, parseMapNameRoom } from "../state/World";
import type { WorldStateShape } from "../state/World";
import { FlashProtocol } from "./FlashProtocol";
import type { FlashProtocolShape } from "./FlashProtocol";

const auraAddCommands = new Set(["aura+", "aura++", "aura+p"]);
const auraRemoveCommands = new Set(["aura-", "aura--"]);

type AuraTargetType = "monster" | "player";
type Disposer = () => void;
type PacketHandler = (packet: FlashPacket) => Effect.Effect<void>;

interface AuraTargetRef {
  readonly targetId: number;
  readonly targetType: AuraTargetType;
}

const packetData = (packet: FlashPacket): unknown => {
  if (packet.direction === "client") {
    return packet.params;
  }

  return packet.data;
};

const parseAuraTargets = (targetInfo: unknown): readonly AuraTargetRef[] => {
  const info = asString(targetInfo);
  if (info === undefined) {
    return [];
  }

  return info.split(",").flatMap((rawToken): readonly AuraTargetRef[] => {
    const trimmed = rawToken.trim();
    const token = trimmed.includes(">")
      ? trimmed.slice(trimmed.lastIndexOf(">") + 1)
      : trimmed;
    const [rawType, rawId] = token.split(":");
    const targetId = asPositiveInt(rawId);
    if (targetId === undefined) {
      return [];
    }

    if (rawType === "p") {
      return [{ targetId, targetType: "player" as const }];
    }

    if (rawType === "m") {
      return [{ targetId, targetType: "monster" as const }];
    }

    return [];
  });
};

const syncDropState = (items: ItemsStateShape, drops: DropsStateShape) =>
  items.getDrops().pipe(Effect.flatMap(drops.replace));

const asDisposerGroup = (
  effect: Effect.Effect<Disposer>,
): Effect.Effect<readonly Disposer[]> =>
  effect.pipe(Effect.map((dispose) => [dispose]));

const onPacketCommands = (
  protocol: FlashProtocolShape,
  selector: Omit<PacketSelector, "command">,
  commands: readonly string[],
  handler: PacketHandler,
): Effect.Effect<readonly Disposer[]> =>
  Effect.forEach(commands, (command) =>
    protocol.onPacket({ ...selector, command }, handler),
  );

const playerLocationFromUpdate = (
  update: Record<string, unknown>,
  current: PlayerRecord | null,
): {
  readonly cell?: string;
  readonly pad?: string;
  readonly position?: Position;
} | null => {
  const x = asNumber(update["tx"] ?? update["px"]);
  const y = asNumber(update["ty"] ?? update["py"]);
  const cell = asString(update["strFrame"]);
  const pad = asString(update["strPad"]);

  if (
    cell === undefined &&
    pad === undefined &&
    x === undefined &&
    y === undefined
  ) {
    return null;
  }

  return {
    ...(cell === undefined ? {} : { cell }),
    ...(pad === undefined ? {} : { pad }),
    ...(x === undefined && y === undefined
      ? {}
      : {
          position: {
            x: x ?? current?.position[0] ?? 0,
            y: y ?? current?.position[1] ?? 0,
          },
        }),
  };
};

const patchFromPlayerUpdate = (
  update: Record<string, unknown>,
  current: PlayerRecord | null,
): Partial<PlayerRecord> => {
  const location = playerLocationFromUpdate(update, current);

  return {
    ...(asBoolean(update["afk"]) === undefined
      ? {}
      : { afk: asBoolean(update["afk"])! }),
    ...(location?.cell === undefined ? {} : { cell: location.cell }),
    ...(asInt(update["intHP"]) === undefined
      ? {}
      : { hp: asInt(update["intHP"])! }),
    ...(asInt(update["intHPMax"]) === undefined
      ? {}
      : { maxHp: asInt(update["intHPMax"])! }),
    ...(asInt(update["intMP"]) === undefined
      ? {}
      : { mp: asInt(update["intMP"])! }),
    ...(asInt(update["intMPMax"]) === undefined
      ? {}
      : { maxMp: asInt(update["intMPMax"])! }),
    ...(location?.pad === undefined ? {} : { pad: location.pad }),
    ...(location?.position === undefined
      ? {}
      : {
          position: [location.position.x, location.position.y] as const,
        }),
    ...(asInt(update["intState"]) === undefined
      ? {}
      : { state: asInt(update["intState"])! }),
  };
};

const patchPlayerFromUpdate = (
  world: WorldStateShape,
  username: string,
  update: Record<string, unknown>,
) =>
  Effect.gen(function* () {
    const current = yield* world.getPlayer(username);
    yield* world.patchPlayer(username, patchFromPlayerUpdate(update, current));
  });

const playerEventBasePayload = (world: WorldStateShape, username: string) =>
  Effect.gen(function* () {
    const current = yield* world.getPlayer(username);
    const self = yield* world.getMe();
    const isSelf = self !== null && equalsIgnoreCase(self.username, username);
    return {
      ...(current?.entityId === undefined
        ? {}
        : { entityId: current.entityId }),
      isSelf,
      username,
    };
  });

const emitPlayerAfkFromUpdate = (
  packet: FlashPacket,
  protocol: FlashProtocolShape,
  world: WorldStateShape,
  username: string,
  update: Record<string, unknown>,
) =>
  Effect.gen(function* () {
    const afk = asBoolean(update["afk"]);
    if (afk === undefined) {
      return;
    }

    const basePayload = yield* playerEventBasePayload(world, username);
    yield* protocol.emitEvent({
      kind: "projection",
      packet,
      payload: { ...basePayload, afk },
      type: "playerAfk",
    });
  });

const emitPlayerLocationFromUpdate = (
  packet: FlashPacket,
  protocol: FlashProtocolShape,
  world: WorldStateShape,
  username: string,
  update: Record<string, unknown>,
) =>
  Effect.gen(function* () {
    const current = yield* world.getPlayer(username);
    const location = playerLocationFromUpdate(update, current);
    if (location === null) {
      return;
    }

    const basePayload = yield* playerEventBasePayload(world, username);
    yield* protocol.emitEvent({
      kind: "projection",
      packet,
      payload: { ...basePayload, ...location },
      type: "playerLocation",
    });
  });

const parseCsvPayload = (data: string): Record<string, string> => {
  const result: Record<string, string> = {};
  for (const token of data.split(",")) {
    const separator = token.indexOf(":");
    if (separator <= 0) {
      continue;
    }

    result[token.slice(0, separator)] = token.slice(separator + 1);
  }
  return result;
};

const playerFromInitPayload = (
  payload: Record<string, unknown>,
): PlayerRecord | null => {
  const userData = asRecord(payload["data"]);
  const entityId =
    asPositiveInt(payload["uid"]) ?? asPositiveInt(userData?.["entID"]);
  return userData !== null && entityId !== undefined
    ? normalizePlayerRecord({ ...userData, entID: entityId })
    : null;
};

const isMonsterDead = (monster: MonsterRecord | null): boolean =>
  monster !== null && (monster.hp <= 0 || monster.state === 0);

const projectMonsterStatePatch = (
  packet: FlashPacket,
  world: WorldStateShape,
  protocol: FlashProtocolShape,
  monsterMapId: number,
  patch: Partial<MonsterRecord>,
) =>
  Effect.gen(function* () {
    const previous = yield* world.getMonster({ monMapId: monsterMapId });
    yield* world.patchMonster(monsterMapId, patch);
    if (
      previous !== null &&
      (patch.hp === 0 || patch.state === 0) &&
      !isMonsterDead(previous)
    ) {
      yield* protocol.emitEvent({
        kind: "projection",
        packet,
        payload: { monsterMapId },
        type: "monsterDeath",
      });
    }
  });

const projectInventoryPacket = (
  packet: FlashPacket,
  items: ItemsStateShape,
  shops: ShopsStateShape,
  drops: DropsStateShape,
) =>
  Effect.gen(function* () {
    const payload = asRecord(packetData(packet));
    switch (packet.command) {
      case "loadInventoryBig": {
        yield* items.setBankCount(asInt(payload?.["bankCount"]) ?? 0);
        yield* items.replaceInventory(asArray(payload?.["items"]));
        yield* items.replaceHouse(asArray(payload?.["hitems"]));
        return;
      }
      case "initInventory":
        yield* items.replaceInventory(asArray(payload?.["items"]));
        return;
      case "loadHouseInventory":
        yield* items.replaceHouse(asArray(payload?.["items"]));
        return;
      case "loadBank":
        if (asBoolean(payload?.["bitSuccess"]) !== false) {
          yield* items.replaceBank(asArray(payload?.["items"]));
        }
        return;
      case "bankFromInv": {
        const itemId = asPositiveInt(payload?.["ItemID"]);
        if (
          itemId !== undefined &&
          asBoolean(payload?.["bSuccess"]) !== false
        ) {
          yield* items.moveInventoryToBank(itemId);
        }
        return;
      }
      case "bankToInv": {
        const itemId = asPositiveInt(payload?.["ItemID"]);
        if (itemId !== undefined) {
          yield* items.moveBankToInventory(itemId);
        }
        return;
      }
      case "bankSwapInv": {
        const inventoryItemId = asPositiveInt(payload?.["invItemID"]);
        const bankItemId = asPositiveInt(payload?.["bankItemID"]);
        if (inventoryItemId !== undefined && bankItemId !== undefined) {
          yield* items.reduceBankSwap(inventoryItemId, bankItemId);
        }
        return;
      }
      case "buyItem": {
        const itemId = asPositiveInt(payload?.["ItemID"]);
        const shopItem =
          itemId === undefined ? null : yield* shops.findByItemId(itemId);
        yield* items.reduceBuyItem(payload, shopItem);
        return;
      }
      case "sellItem":
      case "removeItem":
        yield* items.reduceRemoveItem(payload);
        return;
      case "equipItem": {
        const itemId = asPositiveInt(payload?.["ItemID"]);
        if (itemId !== undefined) {
          yield* items.reduceEquip(itemId, true, asString(payload?.["strES"]));
        }
        return;
      }
      case "unequipItem": {
        const itemId = asPositiveInt(payload?.["ItemID"]);
        if (itemId !== undefined) {
          yield* items.reduceEquip(itemId, false, asString(payload?.["strES"]));
        }
        return;
      }
      case "enhanceItemShop":
      case "enhanceItemLocal":
        yield* items.reduceEnhancement(payload);
        return;
      case "dropItem":
        yield* items.reduceDropItem(payload);
        yield* syncDropState(items, drops);
        return;
      case "getDrop": {
        const itemId = asPositiveInt(payload?.["ItemID"]);
        yield* items.reduceGetDrop(payload);
        if (
          itemId !== undefined &&
          asBoolean(payload?.["bSuccess"]) !== false
        ) {
          yield* drops.remove(itemId);
        }
        return;
      }
      case "addItems":
      case "forceAddItem":
        yield* items.reduceAddItems(payload);
        return;
      case "Wheel": {
        yield* items.reduceAddItems({ items: payload?.["dropItems"] });
        const item = asRecord(payload?.["Item"]);
        const itemId = asPositiveInt(item?.["ItemID"]);
        if (item !== null && itemId !== undefined) {
          yield* items.reduceAddItems({ items: { [itemId]: item } });
        }
        return;
      }
      case "turnIn":
      case "removeTempItem":
        yield* items.reduceTurnIn(payload);
        return;
    }
  });

const projectQuestPacket = (
  packet: FlashPacket,
  quests: QuestsStateShape,
  protocol: FlashProtocolShape,
) =>
  Effect.gen(function* () {
    const payload = packetData(packet);
    switch (packet.command) {
      case "getQuests":
      case "getQuests2":
        yield* quests.reduceGetQuests(payload);
        return;
      case "ccqr": {
        const record = asRecord(payload);
        if (record !== null && asBoolean(record["bSuccess"]) === true) {
          yield* protocol.emitEvent({
            kind: "projection",
            packet,
            payload: record,
            type: "questComplete",
          });
        }
        return;
      }
    }
  });

const projectShopPacket = (packet: FlashPacket, shops: ShopsStateShape) =>
  packet.command === "loadShop"
    ? shops.setInfo(packetData(packet))
    : Effect.void;

const addMoveToAreaState = (
  packet: FlashPacket,
  auth: AuthApiShape,
  world: WorldStateShape,
  protocol: FlashProtocolShape,
) =>
  Effect.gen(function* () {
    const payload = asRecord(packetData(packet));
    if (payload === null) {
      return;
    }

    const mapPatch = {
      ...parseMapNameRoom(asString(payload["areaName"])),
      ...(asPositiveInt(payload["areaId"]) === undefined
        ? {}
        : { id: asPositiveInt(payload["areaId"])! }),
    };
    const currentMap = yield* world.getMap();
    yield* world.setMap({ ...currentMap, ...mapPatch });

    const monsterDefinitions = new Map<number, Record<string, unknown>>();
    for (const rawDefinition of asArray(payload["mondef"])) {
      const definition = asRecord(rawDefinition);
      const monsterId = asPositiveInt(definition?.["MonID"]);
      if (definition !== null && monsterId !== undefined) {
        monsterDefinitions.set(monsterId, definition);
      }
    }

    const monsterCells = new Map<number, string>();
    for (const rawMap of asArray(payload["monmap"])) {
      const mapRecord = asRecord(rawMap);
      const monsterMapId = asPositiveInt(mapRecord?.["MonMapID"]);
      if (monsterMapId !== undefined) {
        monsterCells.set(monsterMapId, asString(mapRecord?.["strFrame"]) ?? "");
      }
    }

    const monsters: MonsterRecord[] = [];
    for (const rawMonster of asArray(payload["monBranch"])) {
      const monster = asRecord(rawMonster);
      const monsterId = asPositiveInt(monster?.["MonID"]);
      const monsterMapId = asPositiveInt(monster?.["MonMapID"]);
      if (
        monster === null ||
        monsterId === undefined ||
        monsterMapId === undefined
      ) {
        continue;
      }

      const definition = monsterDefinitions.get(monsterId);
      const normalized = normalizeMonsterRecord(
        {
          ...definition,
          ...monster,
          strFrame: monsterCells.get(monsterMapId),
        },
        { monsterId, monsterMapId },
      );
      if (normalized !== null) {
        monsters.push(normalized);
      }
    }
    yield* world.setMonsters(monsters);

    const currentUsername = yield* auth
      .getUsername()
      .pipe(Effect.orElseSucceed(() => ""));
    const previousSelf = yield* world.getMe();
    const players: PlayerRecord[] = [];
    let nextSelfUsername: string | null = null;

    for (const rawPlayer of asArray(payload["uoBranch"])) {
      const normalized = normalizePlayerRecord(rawPlayer);
      if (normalized === null) {
        continue;
      }

      players.push(normalized);
      if (
        (previousSelf !== null &&
          equalsIgnoreCase(previousSelf.username, normalized.username)) ||
        (currentUsername !== "" &&
          equalsIgnoreCase(currentUsername, normalized.username))
      ) {
        nextSelfUsername = normalized.username;
      }
    }
    yield* world.setPlayers(players);
    if (nextSelfUsername !== null) {
      yield* world.setSelf(nextSelfUsername);
    }

    const map = yield* world.getMap();
    yield* protocol.emitEvent({
      kind: "projection",
      packet,
      payload: map,
      type: "joinMap",
    });
  });

const projectWorldPacket = (
  packet: FlashPacket,
  auth: AuthApiShape,
  world: WorldStateShape,
  protocol: FlashProtocolShape,
) =>
  Effect.gen(function* () {
    const data = packetData(packet);
    const payload = asRecord(data);

    switch (packet.command) {
      case "moveToArea":
        yield* addMoveToAreaState(packet, auth, world, protocol);
        return;
      case "event": {
        const args = asRecord(payload?.["args"]);
        const map = yield* world.getMap();
        yield* protocol.emitEvent({
          kind: "projection",
          packet,
          payload: {
            map: map.name,
            zone: asString(args?.["zoneSet"]) ?? "",
          },
          type: "zone",
        });
        return;
      }
      case "initUserData": {
        const root = payload;
        const userData = asRecord(root?.["data"]);
        const username = asString(userData?.["strUsername"]);
        const player = root === null ? null : playerFromInitPayload(root);
        if (username !== undefined) {
          yield* world.setSelf(username);
        }
        if (player !== null) {
          yield* world.addPlayer(player);
          yield* world.setSelf(player.username);
        }
        return;
      }
      case "initUserDatas": {
        const currentUsername = yield* auth
          .getUsername()
          .pipe(Effect.orElseSucceed(() => ""));
        for (const rawUser of asArray(payload?.["a"])) {
          const user = asRecord(rawUser);
          const player = user === null ? null : playerFromInitPayload(user);
          if (player !== null) {
            yield* world.addPlayer(player);
            if (
              currentUsername !== "" &&
              equalsIgnoreCase(currentUsername, player.username)
            ) {
              yield* world.setSelf(player.username);
            }
          }
        }
        return;
      }
      case "exitArea": {
        const parts = Array.isArray(data) ? data : [];
        const username = asString(parts[3]);
        if (username !== undefined) {
          yield* world.removePlayer(username);
        }
        return;
      }
      case "mtls": {
        const monsterMapId = asPositiveInt(payload?.["id"]);
        const update = asRecord(payload?.["o"]);
        if (monsterMapId === undefined || update === null) {
          return;
        }

        const patch = {
          ...(asInt(update["intHP"]) === undefined
            ? {}
            : { hp: asInt(update["intHP"])! }),
          ...(asInt(update["intMP"]) === undefined
            ? {}
            : { mp: asInt(update["intMP"])! }),
          ...(asInt(update["intState"]) === undefined
            ? {}
            : { state: asInt(update["intState"])! }),
        };
        yield* projectMonsterStatePatch(
          packet,
          world,
          protocol,
          monsterMapId,
          patch,
        );
        return;
      }
      case "clearAuras": {
        const self = yield* world.getMe();
        if (self !== null) {
          yield* world.clearAuras("player", self.entityId);
        }
        return;
      }
      case "uotls": {
        if (payload !== null) {
          const username = asString(payload["unm"]);
          const update = asRecord(payload["o"]);
          if (username !== undefined && update !== null) {
            yield* patchPlayerFromUpdate(world, username, update);
            yield* emitPlayerAfkFromUpdate(
              packet,
              protocol,
              world,
              username,
              update,
            );
            yield* emitPlayerLocationFromUpdate(
              packet,
              protocol,
              world,
              username,
              update,
            );
          }
        }
        return;
      }
      case "respawnMon": {
        const parts = Array.isArray(data) ? data : [];
        const monsterMapId = asPositiveInt(parts[2]);
        if (monsterMapId !== undefined) {
          const monster = yield* world.getMonster({ monMapId: monsterMapId });
          if (monster !== null) {
            yield* world.patchMonster(monsterMapId, {
              hp: monster.maxHp,
              mp: monster.maxMp,
              state: 1,
            });
          }
        }
        return;
      }
      case "ct":
      case "cb": {
        const playerUpdates = asRecord(payload?.["p"]);
        if (playerUpdates !== null) {
          for (const [username, rawUpdate] of Object.entries(playerUpdates)) {
            const update = asRecord(rawUpdate);
            if (update === null) {
              continue;
            }
            yield* world.patchPlayer(username, {
              ...(asInt(update["intHP"]) === undefined
                ? {}
                : { hp: asInt(update["intHP"])! }),
              ...(asInt(update["intMP"]) === undefined
                ? {}
                : { mp: asInt(update["intMP"])! }),
              ...(asInt(update["intState"]) === undefined
                ? {}
                : { state: asInt(update["intState"])! }),
            });
          }
        }

        const monsterUpdates = asRecord(payload?.["m"]);
        if (monsterUpdates !== null) {
          for (const [rawMonsterMapId, rawUpdate] of Object.entries(
            monsterUpdates,
          )) {
            const monsterMapId = asPositiveInt(rawMonsterMapId);
            const update = asRecord(rawUpdate);
            if (monsterMapId === undefined || update === null) {
              continue;
            }
            const hp = asInt(update["intHP"]);
            const state = asInt(update["intState"]);
            yield* projectMonsterStatePatch(
              packet,
              world,
              protocol,
              monsterMapId,
              {
                ...(hp === undefined ? {} : { hp }),
                ...(asInt(update["intMP"]) === undefined
                  ? {}
                  : { mp: asInt(update["intMP"])! }),
                ...(state === undefined ? {} : { state }),
              },
            );
          }
        }

        for (const rawAuraEvent of asArray(payload?.["a"])) {
          const auraEvent = asRecord(rawAuraEvent);
          const command = asString(auraEvent?.["cmd"]);
          const targets = parseAuraTargets(auraEvent?.["tInf"]);
          if (command === undefined || targets.length === 0) {
            continue;
          }

          if (auraAddCommands.has(command)) {
            for (const rawAura of asArray(auraEvent?.["auras"])) {
              const aura = normalizeAuraRecord(rawAura);
              if (aura !== null) {
                for (const { targetId, targetType } of targets) {
                  yield* world.setAura(targetType, targetId, aura);
                  yield* protocol.emitEvent({
                    kind: "projection",
                    packet,
                    payload: { aura, targetId, targetType },
                    type: "auraAdded",
                  });
                }
              }
            }
          }

          if (auraRemoveCommands.has(command)) {
            const rawAuras =
              asArray(auraEvent?.["auras"]).length > 0
                ? asArray(auraEvent?.["auras"])
                : [auraEvent?.["aura"]];
            for (const rawAura of rawAuras) {
              const auraName = asString(asRecord(rawAura)?.["nam"]);
              if (auraName !== undefined) {
                for (const { targetId, targetType } of targets) {
                  yield* world.unsetAura(targetType, targetId, auraName);
                  yield* protocol.emitEvent({
                    kind: "projection",
                    packet,
                    payload: { auraName, targetId, targetType },
                    type: "auraRemoved",
                  });
                }
              }
            }
          }
        }
        return;
      }
      case "moveToCell": {
        const self = yield* world.getMe();
        const parts = Array.isArray(data) ? data : [];
        const cell = asString(parts[4]);
        const pad = asString(parts[5]);
        if (self !== null && cell !== undefined) {
          yield* world.patchPlayer(self.username, {
            cell,
            ...(pad === undefined ? {} : { pad }),
          });
          yield* protocol.emitEvent({
            kind: "projection",
            packet,
            payload: {
              cell,
              entityId: self.entityId,
              isSelf: true,
              ...(pad === undefined ? {} : { pad }),
              username: self.username,
            },
            type: "playerLocation",
          });
        }
        return;
      }
      case "mv": {
        const self = yield* world.getMe();
        const parts = Array.isArray(data) ? data : [];
        const x = asInt(parts[4]);
        const y = asInt(parts[5]);
        if (self !== null && x !== undefined && y !== undefined) {
          yield* world.patchPlayer(self.username, { position: [x, y] });
          yield* protocol.emitEvent({
            kind: "projection",
            packet,
            payload: {
              entityId: self.entityId,
              isSelf: true,
              position: { x, y },
              username: self.username,
            },
            type: "playerLocation",
          });
        }
        return;
      }
    }
  });

const projectStringUotls = (
  packet: FlashPacket,
  world: WorldStateShape,
  protocol: FlashProtocolShape,
) =>
  Effect.gen(function* () {
    const data = packetData(packet);
    const parts = Array.isArray(data) ? data : [];
    const username = asString(parts[2]);
    const rawUpdate = asString(parts[3]);
    if (username === undefined || rawUpdate === undefined) {
      return;
    }

    const parsed = parseCsvPayload(rawUpdate);
    const update: Record<string, unknown> = {};
    if (parsed["afk"] !== undefined) {
      update["afk"] = parsed["afk"];
    }
    if (parsed["strFrame"] !== undefined) {
      update["strFrame"] = parsed["strFrame"];
    }
    if (parsed["strPad"] !== undefined) {
      update["strPad"] = parsed["strPad"];
    }
    if (parsed["tx"] !== undefined || parsed["px"] !== undefined) {
      update["tx"] = parsed["tx"] ?? parsed["px"];
    }
    if (parsed["ty"] !== undefined || parsed["py"] !== undefined) {
      update["ty"] = parsed["ty"] ?? parsed["py"];
    }

    yield* patchPlayerFromUpdate(world, username, update);
    yield* emitPlayerAfkFromUpdate(packet, protocol, world, username, update);
    yield* emitPlayerLocationFromUpdate(
      packet,
      protocol,
      world,
      username,
      update,
    );
  });

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const drops = yield* DropsState;
    const auth = yield* AuthApi;
    const items = yield* ItemsState;
    const protocol = yield* FlashProtocol;
    const quests = yield* QuestsState;
    const shops = yield* ShopsState;
    const world = yield* WorldState;

    const extensionJson = (
      commands: readonly string[],
      handler: PacketHandler,
    ) =>
      onPacketCommands(
        protocol,
        { direction: "extension", wireType: "json" },
        commands,
        handler,
      );
    const extensionStr = (
      commands: readonly string[],
      handler: PacketHandler,
    ) =>
      onPacketCommands(
        protocol,
        { direction: "extension", wireType: "str" },
        commands,
        handler,
      );
    const serverJson = (commands: readonly string[], handler: PacketHandler) =>
      onPacketCommands(
        protocol,
        { direction: "server", wireType: "json" },
        commands,
        handler,
      );
    const clientStr = (commands: readonly string[], handler: PacketHandler) =>
      onPacketCommands(
        protocol,
        { direction: "client", wireType: "str" },
        commands,
        handler,
      );

    const disposerGroups = yield* Effect.all([
      asDisposerGroup(
        protocol.onEvent({ kind: "runtime", type: "connection" }, (event) =>
          Effect.gen(function* () {
            const status =
              event.type === "connection" ? event.payload.status : "";
            if (
              status === "OnConnectionLost" ||
              status === "OnConnectionFailed"
            ) {
              yield* items.clear();
              yield* drops.clear();
              yield* shops.clear();
              yield* quests.clear();
              yield* world.clear();
            }
          }),
        ),
      ),

      extensionJson(
        [
          "loadInventoryBig",
          "initInventory",
          "loadHouseInventory",
          "loadBank",
          "bankFromInv",
          "bankToInv",
          "bankSwapInv",
          "buyItem",
          "sellItem",
          "removeItem",
          "equipItem",
          "unequipItem",
          "enhanceItemShop",
          "enhanceItemLocal",
          "dropItem",
          "getDrop",
          "addItems",
          "forceAddItem",
          "Wheel",
          "turnIn",
          "removeTempItem",
        ],
        (packet) => projectInventoryPacket(packet, items, shops, drops),
      ),
      extensionJson(["getQuests", "getQuests2", "ccqr"], (packet) =>
        projectQuestPacket(packet, quests, protocol),
      ),
      extensionJson(["loadShop"], (packet) => projectShopPacket(packet, shops)),
      extensionJson(
        [
          "moveToArea",
          "event",
          "initUserData",
          "initUserDatas",
          "mtls",
          "clearAuras",
          "uotls",
          "ct",
          "cb",
        ],
        (packet) => projectWorldPacket(packet, auth, world, protocol),
      ),
      extensionStr(["exitArea", "respawnMon"], (packet) =>
        projectWorldPacket(packet, auth, world, protocol),
      ),
      extensionStr(["uotls"], (packet) =>
        projectStringUotls(packet, world, protocol),
      ),
      serverJson(["ct", "cb"], (packet) =>
        projectWorldPacket(packet, auth, world, protocol),
      ),
      clientStr(["moveToCell", "mv"], (packet) =>
        projectWorldPacket(packet, auth, world, protocol),
      ),
    ]);
    const disposers = disposerGroups.flat();

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        for (const dispose of disposers) {
          dispose();
        }
      }),
    );
  }),
);
