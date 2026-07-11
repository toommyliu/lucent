import { Effect } from "effect";

import { EntityState, LiveAura } from "@lucent/game";
import type { Aura, AuraKind, PlayerData } from "@lucent/game";
import type { FlashPacket, FlashProjectionEvent } from "../../Types";
import { equalsIgnoreCase } from "../../payload";
import type {
  CombatAuraMutation,
  CombatAuraStateChange,
  WorldStateShape,
} from "../../state/World";
import {
  decodeCombatPacket,
  type AuraTargetType,
  type CombatEntityRef,
  type DecodedAuraChange,
  type DecodedAuraData,
} from "../ProjectorDecoders";
import type { TargetRelations } from "./TargetRelations";

interface AuraMutationDescriptor {
  readonly auraName: string;
  readonly command: DecodedAuraChange["command"];
  readonly kind: AuraKind;
  readonly message: string | undefined;
  readonly mutation: CombatAuraMutation;
  readonly phase: "off" | "on";
  readonly source: CombatEntityRef | undefined;
  readonly targetId: number;
  readonly targetType: AuraTargetType;
  consumed: boolean;
}

const cloneAura = (aura: Aura): LiveAura => new LiveAura(aura.toJSON());

const auraModel = (aura: DecodedAuraData): LiveAura =>
  new LiveAura({
    ...(aura.category === undefined ? {} : { category: aura.category }),
    duration: aura.duration,
    ...(aura.icon === undefined ? {} : { icon: aura.icon }),
    kind: aura.kind,
    name: aura.name,
    stack: 1,
    ...(aura.value === undefined ? {} : { value: aura.value }),
  });

const decodeAuraMutations = (
  changes: readonly DecodedAuraChange[],
): readonly AuraMutationDescriptor[] => {
  const descriptors: AuraMutationDescriptor[] = [];
  for (const change of changes) {
    for (const target of change.targets) {
      if (change.operation === "add") {
        for (const aura of change.auras) {
          descriptors.push({
            auraName: aura.name,
            command: change.command,
            consumed: false,
            kind: aura.kind,
            message: aura.messageOn,
            mutation: {
              aura: auraModel(aura),
              operation:
                change.command === "aura+p" || aura.isNew ? "add" : "refresh",
              targetId: target.targetId,
              targetType: target.targetType,
            },
            phase: "on",
            source: change.source,
            targetId: target.targetId,
            targetType: target.targetType,
          });
        }
        continue;
      }

      for (const aura of change.auras) {
        // One removal command applies to matching active and passive entries.
        for (const kind of ["active", "passive"] as const) {
          descriptors.push({
            auraName: aura.name,
            command: change.command,
            consumed: false,
            kind,
            message: aura.messageOff,
            mutation: {
              auraName: aura.name,
              kind,
              operation: "remove",
              targetId: target.targetId,
              targetType: target.targetType,
            },
            phase: "off",
            source: change.source,
            targetId: target.targetId,
            targetType: target.targetType,
          });
        }
      }
    }
  }
  return descriptors;
};

const descriptorForChange = (
  descriptors: readonly AuraMutationDescriptor[],
  change: CombatAuraStateChange,
): AuraMutationDescriptor | undefined => {
  const auraName =
    change.operation === "removed" ? change.auraName : change.aura.name;
  const descriptor = descriptors.find(
    (candidate) =>
      !candidate.consumed &&
      candidate.targetType === change.targetType &&
      candidate.targetId === change.targetId &&
      candidate.kind === change.kind &&
      equalsIgnoreCase(candidate.auraName, auraName),
  );
  if (descriptor !== undefined) descriptor.consumed = true;
  return descriptor;
};

const selfCell = (world: WorldStateShape) =>
  world
    .getMe()
    .pipe(Effect.map((self) => (self === null ? undefined : self.cell)));

const targetIsInSelfCell = (
  world: WorldStateShape,
  targetType: AuraTargetType,
  targetId: number,
) =>
  Effect.gen(function* () {
    const cell = yield* selfCell(world);
    if (cell === undefined) return false;
    if (targetType === "monster") {
      const target = yield* world.getMonster({ monMapId: targetId });
      return target !== null && equalsIgnoreCase(target.cell, cell);
    }
    const target = yield* world.getPlayer(targetId);
    return target !== null && equalsIgnoreCase(target.cell, cell);
  });

const auraMessageIsRelevant = (
  descriptor: AuraMutationDescriptor,
  world: WorldStateShape,
  relations: TargetRelations,
) =>
  Effect.gen(function* () {
    if (descriptor.command === "aura++" || descriptor.command === "aura--") {
      return true;
    }
    if (descriptor.targetType === "player") {
      return yield* targetIsInSelfCell(
        world,
        descriptor.targetType,
        descriptor.targetId,
      );
    }
    if (descriptor.source === undefined) return true;
    if (
      !(yield* targetIsInSelfCell(
        world,
        descriptor.targetType,
        descriptor.targetId,
      ))
    ) {
      return false;
    }
    return relations.has(descriptor.source, {
      id: descriptor.targetId,
      type: "m",
    });
  });

const auraUpdateMessage = (
  packet: FlashPacket,
  descriptor: AuraMutationDescriptor,
  world: WorldStateShape,
  relations: TargetRelations,
): Effect.Effect<FlashProjectionEvent | null> =>
  Effect.gen(function* () {
    if (descriptor.kind === "passive") return null;
    let message = descriptor.message;
    if (message === undefined) return null;

    // A leading @ marks a self-local client update message.
    if (message.startsWith("@")) {
      if (descriptor.targetType !== "player") return null;
      const self = yield* world.getMe();
      if (self?.entityId !== descriptor.targetId) return null;
      message = message.slice(1).trim();
      if (message === "") return null;
    }
    if (!(yield* auraMessageIsRelevant(descriptor, world, relations))) {
      return null;
    }

    const target =
      descriptor.targetType === "monster"
        ? yield* world.getMonster({ monMapId: descriptor.targetId })
        : yield* world.getPlayer(descriptor.targetId);
    return {
      kind: "projection",
      packet,
      payload: {
        auraName: descriptor.auraName,
        auraPhase: descriptor.phase,
        message,
        ...(descriptor.targetType === "monster"
          ? { monMapId: descriptor.targetId }
          : {}),
        source: "aura",
        targetId: descriptor.targetId,
        ...(target === null ? {} : { targetName: target.name }),
        targetType: descriptor.targetType,
      },
      type: "updateMessage",
    };
  });

const auraEvents = (
  packet: FlashPacket,
  changes: readonly CombatAuraStateChange[],
  descriptors: readonly AuraMutationDescriptor[],
  world: WorldStateShape,
  relations: TargetRelations,
) =>
  Effect.gen(function* () {
    const events: FlashProjectionEvent[] = [];
    for (const change of changes) {
      if (change.operation === "removed") {
        events.push({
          kind: "projection",
          packet,
          payload: {
            auraName: change.auraName,
            auraKind: change.kind,
            remainingStack: change.remainingStack,
            targetId: change.targetId,
            targetType: change.targetType,
          },
          type: "auraRemoved",
        });
      } else {
        events.push({
          kind: "projection",
          packet,
          payload: {
            aura: cloneAura(change.aura),
            auraKind: change.kind,
            targetId: change.targetId,
            targetType: change.targetType,
          },
          type: "auraAdded",
        });
      }

      const descriptor = descriptorForChange(descriptors, change);
      if (descriptor !== undefined) {
        const message = yield* auraUpdateMessage(
          packet,
          descriptor,
          world,
          relations,
        );
        if (message !== null) events.push(message);
      }
    }
    return events;
  });

const animationEvents = (
  packet: FlashPacket,
  combat: NonNullable<ReturnType<typeof decodeCombatPacket>>,
  world: WorldStateShape,
) =>
  Effect.forEach(combat.animations, (animation) =>
    Effect.gen(function* () {
      const monMapId =
        animation.sourceMonsterMapId ?? animation.targetMonsterMapId;
      const source =
        animation.sourceMonsterMapId === undefined
          ? null
          : yield* world.getMonster({
              monMapId: animation.sourceMonsterMapId,
            });
      const message =
        source === null
          ? animation.message
          : animation.message.replaceAll("<mon>", source.name);
      return {
        kind: "projection",
        packet,
        payload: {
          message,
          ...(monMapId === undefined ? {} : { monMapId }),
          source: "animation",
          ...(animation.sourceMonsterMapId === undefined
            ? {}
            : { sourceMonMapId: animation.sourceMonsterMapId }),
          ...(animation.targetMonsterMapId === undefined
            ? {}
            : { targetMonMapId: animation.targetMonsterMapId }),
        },
        type: "updateMessage",
      } satisfies FlashProjectionEvent;
    }),
  );

export const projectCombatPacket = (
  packet: FlashPacket,
  world: WorldStateShape,
  relations: TargetRelations,
): Effect.Effect<readonly FlashProjectionEvent[]> =>
  Effect.gen(function* () {
    const combat = decodeCombatPacket(packet);
    if (combat === null) return [];

    const descriptors = decodeAuraMutations(combat.auraChanges);
    const playerPatches = yield* Effect.forEach(
      combat.playerUpdates,
      (update) =>
        Effect.gen(function* () {
          const location = update.location;
          if (location?.x === undefined && location?.y === undefined) {
            return { patch: update.patch, username: update.username };
          }

          const current = yield* world.getPlayer(update.username);
          const patch: Partial<PlayerData> =
            current === null
              ? update.patch
              : {
                  ...update.patch,
                  position: {
                    x: location.x ?? current.position.x,
                    y: location.y ?? current.position.y,
                  },
                };
          return { patch, username: update.username };
        }),
    );
    const result = yield* world.reduceCombatState({
      auraMutations: descriptors.map((descriptor) => descriptor.mutation),
      monsterPatches: combat.monsterUpdates,
      playerPatches,
    });

    relations.applyServerAggro(combat.payload);
    for (const update of combat.playerUpdates) {
      if (
        update.patch.state === undefined ||
        update.patch.state === EntityState.InCombat
      ) {
        continue;
      }
      const player = yield* world.getPlayer(update.username);
      if (player !== null) {
        relations.remove({ id: player.entityId, type: "p" });
      }
    }
    for (const update of combat.monsterUpdates) {
      if (
        update.patch.state !== undefined &&
        update.patch.state !== EntityState.InCombat
      ) {
        relations.remove({ id: update.monsterMapId, type: "m" });
      }
    }
    for (const death of result.playerDeaths) {
      relations.remove({ id: death.entityId, type: "p" });
    }
    for (const death of result.monsterDeaths) {
      relations.remove({ id: death.monsterMapId, type: "m" });
    }

    const deathEvents: FlashProjectionEvent[] = [
      ...result.playerDeaths.map(
        (payload): FlashProjectionEvent => ({
          kind: "projection",
          packet,
          payload,
          type: "playerDeath",
        }),
      ),
      ...result.monsterDeaths.map(
        (payload): FlashProjectionEvent => ({
          kind: "projection",
          packet,
          payload,
          type: "monsterDeath",
        }),
      ),
    ];
    const projectedAuras = yield* auraEvents(
      packet,
      result.auraChanges,
      descriptors,
      world,
      relations,
    );
    const projectedAnimations = yield* animationEvents(packet, combat, world);

    return combat.command === "cb"
      ? [...deathEvents, ...projectedAnimations, ...projectedAuras]
      : [...deathEvents, ...projectedAuras, ...projectedAnimations];
  });
