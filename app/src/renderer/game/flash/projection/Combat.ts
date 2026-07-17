import { Effect, Option, Schema } from "effect";

import type { Event } from "../contract/Event";
import {
  ignoreDiagnostic,
  type DiagnosticReporter,
} from "../contract/Diagnostic";
import type { ExtensionPacket, ServerPacket } from "../contract/Packet";
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
  cmd: Schema.Literals([
    "aura+",
    "aura++",
    "aura+p",
    "aura-",
    "aura--",
    "aura-p",
  ]),
  tInf: Schema.String,
});
const Animation = Schema.Struct({
  cInf: Schema.optionalKey(Schema.String),
  msg: Schema.Union([Schema.String, Schema.Array(Schema.String)]),
  tInf: Schema.optionalKey(Schema.String),
});
const CombatPayload = Schema.Struct({
  a: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.Unknown))),
  anims: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.Unknown))),
  m: Schema.optionalKey(
    Schema.NullOr(Schema.Record(Schema.String, Schema.Unknown)),
  ),
  p: Schema.optionalKey(
    Schema.NullOr(Schema.Record(Schema.String, Schema.Unknown)),
  ),
});
const decodeCombat = Schema.decodeUnknownOption(CombatPayload);
const decodeAnimation = Schema.decodeUnknownOption(Animation);
const decodeAuraChange = Schema.decodeUnknownOption(AuraChange);
const decodeEntityPatch = Schema.decodeUnknownOption(EntityPatchPayload);

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
  packet: ExtensionPacket | ServerPacket,
  diagnose: DiagnosticReporter = ignoreDiagnostic,
): Effect.Effect<readonly Event[]> =>
  Effect.gen(function* () {
    if (packet.command !== "ct" && packet.command !== "cb") return [];
    const decoded = decodeCombat(packet.data);
    if (Option.isNone(decoded)) {
      yield* diagnose(
        `combat:${packet.command}`,
        new Error("Malformed combat payload"),
        [packet.data],
      );
      return [];
    }
    const events: Event[] = [];

    for (const [username, value] of Object.entries(decoded.value.p ?? {})) {
      const patch = decodeEntityPatch(value);
      if (Option.isNone(patch)) {
        yield* diagnose(
          "combat:malformed-player-update",
          new Error("Ignored malformed player combat update"),
          [username, value],
        );
        continue;
      }
      const current = yield* store.world.getPlayer(username);
      if (current === null) {
        yield* diagnose(
          "combat:unknown-player-update",
          new Error("Ignored update for unknown player"),
          [username, packet.data],
        );
        continue;
      }
      const result = yield* store.world.patchPlayer(username, {
        ...entityPatch(patch.value),
        ...(patch.value.afk === undefined ? {} : { afk: patch.value.afk }),
        ...(patch.value.intLevel === undefined
          ? {}
          : { level: patch.value.intLevel }),
        ...(patch.value.strPad === undefined
          ? {}
          : { pad: patch.value.strPad }),
        ...(patch.value.tx === undefined && patch.value.ty === undefined
          ? {}
          : {
              position: {
                x: patch.value.tx ?? current.position.x,
                y: patch.value.ty ?? current.position.y,
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

    for (const [rawId, value] of Object.entries(decoded.value.m ?? {})) {
      const id = Number(rawId);
      if (!Number.isInteger(id) || id <= 0) continue;
      const patch = decodeEntityPatch(value);
      if (Option.isNone(patch)) {
        yield* diagnose(
          "combat:malformed-monster-update",
          new Error("Ignored malformed monster combat update"),
          [rawId, value],
        );
        continue;
      }
      const result = yield* store.world.patchMonster(
        id,
        entityPatch(patch.value),
      );
      if (result === null) {
        yield* diagnose(
          "combat:unknown-monster-update",
          new Error("Ignored update for unknown monster"),
          [id, packet.data],
        );
        continue;
      }
      if (result?.becameDead) {
        events.push({ type: "monster-death", monsterMapId: id });
      }
    }

    for (const value of decoded.value.a ?? []) {
      const change = decodeAuraChange(value);
      if (Option.isNone(change)) {
        yield* diagnose(
          "combat:malformed-aura-change",
          new Error("Ignored malformed aura change"),
          [value],
        );
        continue;
      }
      const operation = change.value.cmd.startsWith("aura+") ? "add" : "remove";
      const kind = change.value.cmd.endsWith("p") ? "passive" : "active";
      const payloads =
        change.value.auras ??
        (change.value.aura === undefined ? [] : [change.value.aura]);
      for (const target of targets(change.value.tInf)) {
        for (const payload of payloads) {
          if (operation === "add") {
            const auraOperation =
              change.value.cmd === "aura++" ||
              change.value.cmd === "aura+p" ||
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

    for (const value of decoded.value.anims ?? []) {
      const animation = decodeAnimation(value);
      if (Option.isNone(animation)) continue;
      const message =
        typeof animation.value.msg === "string"
          ? animation.value.msg.trim()
          : animation.value.msg.join(" ").trim();
      if (message === "") continue;
      const source =
        animation.value.cInf === undefined ? [] : targets(animation.value.cInf);
      const target =
        animation.value.tInf === undefined ? [] : targets(animation.value.tInf);
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
