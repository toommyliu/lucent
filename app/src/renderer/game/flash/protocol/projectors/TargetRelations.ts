import { Effect } from "effect";

import type { FlashPacket } from "../../Types";
import { asArray, asNumber, asPositiveInt, asRecord } from "../../payload";
import type { WorldStateShape } from "../../state/World";
import {
  packetData,
  parseCombatEntityRefs,
  type CombatEntityRef,
} from "../ProjectorDecoders";

type CombatEntityKey = `${CombatEntityRef["type"]}:${number}`;

export interface TargetRelations {
  readonly applyClientGar: (
    packet: FlashPacket,
    world: WorldStateShape,
  ) => Effect.Effect<void>;
  readonly applyServerAggro: (payload: Record<string, unknown>) => void;
  readonly has: (source: CombatEntityRef, target: CombatEntityRef) => boolean;
  readonly remove: (entity: CombatEntityRef) => void;
  readonly reset: () => void;
}

const keyOf = (ref: CombatEntityRef): CombatEntityKey =>
  `${ref.type}:${ref.id}`;

export const makeTargetRelations = (): TargetRelations => {
  const relations = new Map<CombatEntityKey, Set<CombatEntityKey>>();

  const add = (source: CombatEntityRef, target: CombatEntityRef): void => {
    const sourceKey = keyOf(source);
    const targets = relations.get(sourceKey) ?? new Set<CombatEntityKey>();
    targets.add(keyOf(target));
    relations.set(sourceKey, targets);
  };

  const addMutual = (
    source: CombatEntityRef,
    target: CombatEntityRef,
  ): void => {
    add(source, target);
    add(target, source);
  };

  const applyAggro = (
    sourceInfo: unknown,
    targetInfo: unknown,
    isDamage: boolean,
  ): void => {
    const source = parseCombatEntityRefs(sourceInfo)[0];
    const target = parseCombatEntityRefs(targetInfo)[0];
    if (source === undefined || target === undefined) return;

    if (target.type === "m") {
      addMutual(source, target);
      return;
    }

    if (source.type !== "p" || target.type !== "p" || !isDamage) return;
    const damagedPlayer = keyOf(target);
    for (const [entityKey, targets] of relations) {
      if (!entityKey.startsWith("m:") || !targets.has(damagedPlayer)) continue;
      const monsterMapId = asPositiveInt(entityKey.slice("m:".length));
      if (monsterMapId !== undefined) {
        add({ id: monsterMapId, type: "m" }, source);
      }
    }
  };

  return {
    applyClientGar: (packet, world) =>
      Effect.gen(function* () {
        const self = yield* world.getMe();
        if (self === null) return;

        const parts = packetData(packet);
        for (const target of (Array.isArray(parts) ? parts : []).flatMap(
          parseCombatEntityRefs,
        )) {
          if (target.type === "m") {
            addMutual({ id: self.entityId, type: "p" }, target);
          }
        }
      }),
    applyServerAggro: (payload) => {
      for (const rawAction of asArray(payload["sara"])) {
        const action = asRecord(rawAction);
        if (action === null || asNumber(action["iRes"]) === 0) continue;
        const result = asRecord(action["actionResult"]);
        if (result === null || result["typ"] === "d") continue;
        applyAggro(
          result["cInf"],
          result["tInf"],
          (asNumber(result["hp"]) ?? 0) >= 0,
        );
      }

      for (const rawAction of asArray(payload["sarsa"])) {
        const action = asRecord(rawAction);
        if (action === null || asNumber(action["iRes"]) === 0) continue;
        for (const rawApplied of asArray(action["a"])) {
          const applied = asRecord(rawApplied);
          if (applied !== null) {
            applyAggro(
              action["cInf"],
              applied["tInf"],
              (asNumber(applied["hp"]) ?? 0) >= 0,
            );
          }
        }
      }
    },
    has: (source, target) =>
      relations.get(keyOf(source))?.has(keyOf(target)) === true,
    remove: (entity) => {
      const key = keyOf(entity);
      relations.delete(key);
      for (const targets of relations.values()) targets.delete(key);
    },
    reset: () => relations.clear(),
  };
};
