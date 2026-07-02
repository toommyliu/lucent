import { Effect, Layer } from "effect";

import type { FlashPacket } from "../Types";
import { AuthApi, type AuthApiShape } from "../api/Auth";
import {
  asArray,
  asBoolean,
  asInt,
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

const shouldProjectPacket = (packet: FlashPacket): boolean =>
  packet.direction !== "server" || packet.command === "ct";

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

const reduceInventoryPacket = (
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
        if (itemId !== undefined) {
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

const reduceQuestPacket = (
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
            packet,
            payload: record,
            type: "questComplete",
          });
        }
        return;
      }
    }
  });

const reduceShopPacket = (packet: FlashPacket, shops: ShopsStateShape) =>
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
    yield* world.patchMap(mapPatch);

    const map = yield* world.getMap();
    yield* protocol.emitEvent({
      packet,
      payload: map,
      type: "joinMap",
    });

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
        yield* world.addMonster(normalized);
      }
    }

    const currentUsername = yield* auth
      .getUsername()
      .pipe(Effect.orElseSucceed(() => ""));

    for (const rawPlayer of asArray(payload["uoBranch"])) {
      const normalized = normalizePlayerRecord(rawPlayer);
      if (normalized === null) {
        continue;
      }

      yield* world.addPlayer(normalized);
      const self = yield* world.getMe();
      if (
        (self !== null &&
          equalsIgnoreCase(self.username, normalized.username)) ||
        (currentUsername !== "" &&
          equalsIgnoreCase(currentUsername, normalized.username))
      ) {
        yield* world.setSelf(normalized.username);
      }
    }
  });

const reduceWorldPacket = (
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
        const entityId = asPositiveInt(userData?.["entID"]);
        const player =
          userData !== null && username !== undefined && entityId !== undefined
            ? normalizePlayerRecord({ ...userData, entID: entityId })
            : null;
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
        for (const rawUser of asArray(payload?.["a"])) {
          const user = asRecord(rawUser);
          const dataRecord = asRecord(user?.["data"]);
          const entityId = asPositiveInt(dataRecord?.["entID"]);
          const player =
            dataRecord !== null && entityId !== undefined
              ? normalizePlayerRecord({ ...dataRecord, entID: entityId })
              : null;
          if (player !== null) {
            yield* world.addPlayer(player);
            const currentUsername = yield* auth
              .getUsername()
              .pipe(Effect.orElseSucceed(() => ""));
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
        yield* world.patchMonster(monsterMapId, patch);
        if (patch.hp === 0 || patch.state === 0) {
          yield* protocol.emitEvent({
            packet,
            payload: { monsterMapId },
            type: "monsterDeath",
          });
        }
        return;
      }
      case "uotls": {
        if (payload !== null) {
          const username = asString(payload["unm"]);
          const update = asRecord(payload["o"]);
          if (username !== undefined && update !== null) {
            const patch = {
              ...(asBoolean(update["afk"]) === undefined
                ? {}
                : { afk: asBoolean(update["afk"])! }),
              ...(asString(update["strFrame"]) === undefined
                ? {}
                : { cell: asString(update["strFrame"])! }),
              ...(asInt(update["intHP"]) === undefined
                ? {}
                : { hp: asInt(update["intHP"])! }),
              ...(asInt(update["intMP"]) === undefined
                ? {}
                : { mp: asInt(update["intMP"])! }),
              ...(asString(update["strPad"]) === undefined
                ? {}
                : { pad: asString(update["strPad"])! }),
              ...(asInt(update["intState"]) === undefined
                ? {}
                : { state: asInt(update["intState"])! }),
            };
            yield* world.patchPlayer(username, patch);
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
            yield* world.patchMonster(monsterMapId, {
              ...(hp === undefined ? {} : { hp }),
              ...(asInt(update["intMP"]) === undefined
                ? {}
                : { mp: asInt(update["intMP"])! }),
              ...(state === undefined ? {} : { state }),
            });
            if (hp === 0 || state === 0) {
              yield* protocol.emitEvent({
                packet,
                payload: { monsterMapId },
                type: "monsterDeath",
              });
            }
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
            packet,
            payload: {
              cell,
              ...(pad === undefined ? {} : { pad }),
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
            packet,
            payload: { position: { x, y } },
            type: "playerLocation",
          });
        }
        return;
      }
      case "addGoldExp": {
        const monsterMapId = asPositiveInt(payload?.["id"]);
        if (asString(payload?.["typ"]) === "m" && monsterMapId !== undefined) {
          yield* world.patchMonster(monsterMapId, { hp: 0, mp: 0, state: 0 });
          yield* protocol.emitEvent({
            packet,
            payload: { monsterMapId },
            type: "monsterDeath",
          });
        }
        return;
      }
    }
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

    const disposeConnection = yield* protocol.onEvent(
      { type: "connection" },
      (event) =>
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
    );

    const disposePackets = yield* protocol.onPacket(undefined, (packet) =>
      Effect.gen(function* () {
        if (!shouldProjectPacket(packet)) {
          return;
        }

        yield* reduceShopPacket(packet, shops);
        yield* reduceInventoryPacket(packet, items, shops, drops);
        yield* reduceQuestPacket(packet, quests, protocol);
        yield* reduceWorldPacket(packet, auth, world, protocol);
      }),
    );

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        disposeConnection();
        disposePackets();
      }),
    );
  }),
);
