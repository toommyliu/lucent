import { Effect, Option, Schema } from "effect";

import type { Event } from "../contract/Event";
import { packetData, type Packet } from "../contract/Packet";
import { AuraPayload, toAura } from "../contract/payload/Combat";
import {
  EntityPatchPayload,
  entityState,
  type EntityPatchPayload as EntityPatch,
} from "../contract/payload/World";
import type { Store } from "../state/Store";

const AuraChange = Schema.Struct({
  auras: Schema.optionalKey(Schema.Array(AuraPayload)),
  aura: Schema.optionalKey(AuraPayload),
  cmd: Schema.Literals(["aura+", "aura++", "aura+p", "aura-", "aura--"]),
  tInf: Schema.String,
});
const CombatPayload = Schema.Struct({
  a: Schema.optionalKey(Schema.Array(AuraChange)),
  m: Schema.optionalKey(Schema.Record(Schema.String, EntityPatchPayload)),
  p: Schema.optionalKey(Schema.Record(Schema.String, EntityPatchPayload)),
});
const decodeCombat = Schema.decodeUnknownOption(CombatPayload);

const targets = (value: string) =>
  value.split(",").flatMap((token) => {
    const target = token.slice(token.lastIndexOf(">") + 1).trim();
    const [type, rawId] = target.split(":");
    const id = Number(rawId);
    return (type === "m" || type === "p") && Number.isInteger(id) && id > 0
      ? [
          {
            id,
            type: type === "m" ? ("monster" as const) : ("player" as const),
          },
        ]
      : [];
  });

const entityPatch = (patch: EntityPatch) => ({
  ...(patch.intHP === undefined ? {} : { hp: patch.intHP }),
  ...(patch.intHPMax === undefined ? {} : { maxHp: patch.intHPMax }),
  ...(patch.intMP === undefined ? {} : { mp: patch.intMP }),
  ...(patch.intMPMax === undefined ? {} : { maxMp: patch.intMPMax }),
  ...(patch.strFrame === undefined ? {} : { cell: patch.strFrame }),
  ...(entityState(patch.intState) === undefined
    ? {}
    : { state: entityState(patch.intState)! }),
});

export const projectCombat = (
  store: Store,
  packet: Packet,
): Effect.Effect<readonly Event[]> =>
  Effect.gen(function* () {
    if (packet.command !== "ct" && packet.command !== "cb") return [];
    const decoded = decodeCombat(packetData(packet));
    if (Option.isNone(decoded)) return [];
    const events: Event[] = [];

    for (const [username, patch] of Object.entries(decoded.value.p ?? {})) {
      const current = yield* store.world.getPlayer(username);
      if (current === null) continue;
      const result = yield* store.world.patchPlayer(username, {
        ...entityPatch(patch),
        ...(patch.afk === undefined ? {} : { afk: patch.afk }),
        ...(patch.intLevel === undefined ? {} : { level: patch.intLevel }),
        ...(patch.strPad === undefined ? {} : { pad: patch.strPad }),
        ...(patch.tx === undefined && patch.ty === undefined
          ? {}
          : {
              position: {
                x: patch.tx ?? current.position.x,
                y: patch.ty ?? current.position.y,
              },
            }),
      });
      if (result?.becameDead) {
        events.push({
          type: "player-death",
          entityId: result.player.entityId,
          username: result.player.username,
        });
      }
    }

    for (const [rawId, patch] of Object.entries(decoded.value.m ?? {})) {
      const id = Number(rawId);
      if (!Number.isInteger(id) || id <= 0) continue;
      const result = yield* store.world.patchMonster(id, entityPatch(patch));
      if (result?.becameDead) {
        events.push({ type: "monster-death", monsterMapId: id });
      }
    }

    for (const change of decoded.value.a ?? []) {
      const operation = change.cmd.startsWith("aura+") ? "add" : "remove";
      const kind = change.cmd === "aura+p" ? "passive" : "active";
      const payloads =
        change.auras ?? (change.aura === undefined ? [] : [change.aura]);
      for (const target of targets(change.tInf)) {
        for (const payload of payloads) {
          if (operation === "add") {
            yield* store.world.addAura(
              target.type,
              target.id,
              toAura(payload, kind),
            );
            events.push({
              type: "aura-added",
              name: payload.nam,
              targetId: target.id,
              targetType: target.type,
            });
          } else {
            yield* store.world.removeAura(
              target.type,
              target.id,
              payload.nam,
              kind,
            );
            events.push({
              type: "aura-removed",
              name: payload.nam,
              targetId: target.id,
              targetType: target.type,
            });
          }
        }
      }
    }

    return events;
  });
