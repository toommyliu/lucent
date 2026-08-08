import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type { MonsterDrop } from "@lucent/game";

import {
  ignoreDiagnostic,
  type DiagnosticReporter,
} from "../contract/Diagnostic";
import type { ExtensionPacket } from "../contract/Packet";
import {
  decodeMonsterDropItem,
  decodeMonsterDrops,
  toMonsterDrop,
} from "../contract/payload/MonsterDrops";
import type { Store } from "../state/Store";

export const projectMonsterDrops = Effect.fn("projectMonsterDrops")(function* (
  store: Store,
  packet: ExtensionPacket,
  diagnose: DiagnosticReporter = ignoreDiagnostic,
): Effect.fn.Return<readonly []> {
  const decoded = decodeMonsterDrops(packet.data);
  if (Option.isNone(decoded)) {
    yield* diagnose(
      "monster-drops:response",
      new Error("Malformed monster drop response"),
      [packet.data],
    );
    return [];
  }

  const drops: MonsterDrop[] = [];
  const invalid: unknown[] = [];
  for (const value of Object.values(decoded.value.items)) {
    const item = decodeMonsterDropItem(value);
    if (Option.isNone(item)) invalid.push(value);
    else drops.push(toMonsterDrop(item.value));
  }

  if (invalid.length > 0) {
    yield* diagnose(
      "monster-drops:items",
      new Error(`Ignored ${invalid.length} malformed monster drop entries`),
      invalid,
    );
  }

  const stored = yield* store.world.setMonsterDrops(
    decoded.value.MonMapID,
    drops,
  );
  if (!stored) {
    yield* diagnose(
      "monster-drops:unknown-monster",
      new Error("Ignored drops for a monster outside the current area"),
      [decoded.value.MonMapID],
    );
  }
  return [];
});
