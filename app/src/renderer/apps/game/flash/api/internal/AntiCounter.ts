import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";

import type { BridgeService } from "../../bridge/Bridge";
import type { Event } from "../../contract/Event";
import { antiCounterExpiresAtMs } from "../../domain/AntiCounter";
import { readCombatTarget, stopCombat } from "./CombatControl";

interface TrackedAntiCounter {
  readonly cancellationIssued: boolean;
  readonly expiresAtMs: number;
}

const resetConnectionStatuses = new Set([
  "OnConnection",
  "OnConnectionFailed",
  "OnConnectionLost",
]);

export const makeAntiCounter = (
  bridge: BridgeService,
  isEnabled: () => Effect.Effect<boolean>,
) => {
  const tracked = new Map<number, TrackedAntiCounter>();

  const isActive = Effect.fn("AntiCounter.isActive")(function* (
    monsterMapId: number,
  ) {
    const current = tracked.get(monsterMapId);
    if (current === undefined) return false;
    if (current.expiresAtMs > (yield* Clock.currentTimeMillis)) return true;
    tracked.delete(monsterMapId);
    return false;
  });

  const clear = (monsterMapId?: number) =>
    Effect.sync(() => {
      if (monsterMapId === undefined) {
        tracked.clear();
      } else {
        tracked.delete(monsterMapId);
      }
    });

  const handleStart = Effect.fn("AntiCounter.handleStart")(function* (
    event: Extract<Event, { readonly type: "counter-attack-start" }>,
  ) {
    const now = yield* Clock.currentTimeMillis;
    const previous = tracked.get(event.monsterMapId);
    const wasActive = previous !== undefined && previous.expiresAtMs > now;
    tracked.set(event.monsterMapId, {
      cancellationIssued: wasActive ? previous.cancellationIssued : false,
      expiresAtMs: antiCounterExpiresAtMs(now, event.durationMs),
    });

    if ((wasActive && previous.cancellationIssued) || !(yield* isEnabled())) {
      return;
    }

    const target = yield* readCombatTarget(bridge);
    if (
      target?.type !== "monster" ||
      target.monsterMapId !== event.monsterMapId
    ) {
      return;
    }

    yield* stopCombat(bridge);
    const current = tracked.get(event.monsterMapId);
    if (current !== undefined) {
      tracked.set(event.monsterMapId, {
        ...current,
        cancellationIssued: true,
      });
    }
  });

  const handleEvent = Effect.fn("AntiCounter.handleEvent")(function* (
    event: Event,
  ) {
    switch (event.type) {
      case "counter-attack-start":
        yield* handleStart(event);
        return;
      case "counter-attack-end":
      case "monster-death":
        yield* clear(event.monsterMapId);
        return;
      case "join-map":
        yield* clear();
        return;
      case "connection":
        if (resetConnectionStatuses.has(event.status)) yield* clear();
        return;
      default:
        return;
    }
  });

  return {
    handleEvent,
    isActive,
  };
};

export type AntiCounter = ReturnType<typeof makeAntiCounter>;
