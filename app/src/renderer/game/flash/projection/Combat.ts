import { Effect, Option, Schema } from "effect";

import type { Event } from "../contract/Event";
import {
  ignoreDiagnostic,
  type DiagnosticReporter,
} from "../contract/Diagnostic";
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
  cInf: Schema.optionalKey(Schema.String),
  cmd: Schema.Literals(["aura+", "aura++", "aura+p", "aura-", "aura--"]),
  tInf: Schema.String,
});
const CombatPayload = Schema.Struct({
  a: Schema.optionalKey(Schema.Array(AuraChange)),
  anims: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        cInf: Schema.optionalKey(Schema.String),
        msg: Schema.Union([Schema.String, Schema.Array(Schema.String)]),
        tInf: Schema.optionalKey(Schema.String),
      }),
    ),
  ),
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

const messageText = (
  value: string | readonly string[] | undefined,
): string | undefined => {
  if (value === undefined) return undefined;

  const message =
    typeof value === "string" ? value.trim() : value.join(" ").trim();
  return message === "" ? undefined : message;
};

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
  diagnose: DiagnosticReporter = ignoreDiagnostic,
): Effect.Effect<readonly Event[]> =>
  Effect.gen(function* () {
    if (packet.command !== "ct" && packet.command !== "cb") return [];
    const decoded = decodeCombat(packetData(packet));
    if (Option.isNone(decoded)) {
      yield* diagnose(
        `combat:${packet.command}`,
        new Error("Malformed combat payload"),
        ["[payload omitted]"],
      );
      return [];
    }
    const events: Event[] = [];

    for (const [username, patch] of Object.entries(decoded.value.p ?? {})) {
      const current = yield* store.world.getPlayer(username);
      if (current === null) {
        yield* diagnose(
          "combat:unknown-player-update",
          new Error("Ignored update for unknown player"),
          [username],
        );
        continue;
      }
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
      if (result === null) {
        yield* diagnose(
          "combat:unknown-monster-update",
          new Error("Ignored update for unknown monster"),
          [id],
        );
        continue;
      }
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
            const auraOperation =
              change.cmd === "aura++" ||
              change.cmd === "aura+p" ||
              payload.isNew === true
                ? "add"
                : "refresh";
            yield* store.world.addAura(
              target.type,
              target.id,
              toAura(payload, kind),
              auraOperation,
            );
            events.push({
              type: "aura-added",
              name: payload.nam,
              targetId: target.id,
              targetType: target.type,
            });
          } else {
            yield* store.world.removeAura(target.type, target.id, payload.nam);
            events.push({
              type: "aura-removed",
              name: payload.nam,
              targetId: target.id,
              targetType: target.type,
            });
          }

          const rawMessage =
            operation === "add" ? payload.msgOn : payload.msgOff;
          const message = messageText(rawMessage);
          if (message !== undefined && kind === "active") {
            const isSelfOnly = message.startsWith("@");
            const self = isSelfOnly ? yield* store.world.getMe : null;
            if (
              !isSelfOnly ||
              (target.type === "player" && self?.entityId === target.id)
            ) {
              const normalized = isSelfOnly ? message.slice(1).trim() : message;
              if (normalized !== "") {
                events.push({
                  type: "update-message",
                  message: normalized,
                  ...(target.type === "monster"
                    ? { monsterMapId: target.id }
                    : {}),
                  source: "aura",
                });
              }
            }
          }
        }
      }
    }

    for (const animation of decoded.value.anims ?? []) {
      const message =
        typeof animation.msg === "string"
          ? animation.msg.trim()
          : animation.msg.join(" ").trim();
      if (message === "") continue;
      const source =
        animation.cInf === undefined ? [] : targets(animation.cInf);
      const target =
        animation.tInf === undefined ? [] : targets(animation.tInf);
      const monsterMapId = [...source, ...target].find(
        (entity) => entity.type === "monster",
      )?.id;
      const monster =
        monsterMapId === undefined
          ? null
          : yield* store.world.getMonster(monsterMapId);
      events.push({
        type: "update-message",
        message:
          monster === null
            ? message
            : message.replaceAll("<mon>", monster.name),
        ...(monsterMapId === undefined ? {} : { monsterMapId }),
        source: "animation",
      });
    }

    return events;
  });
