import type { Collection } from "@lucent/collection";
import { ServiceMap } from "effect";
import type { Effect, Option } from "effect";
import type { BridgeEffect } from "./Bridge";
import type { Quest } from "@lucent/game";

export type QuestLoadedListener = (
  questIds: readonly number[],
) => Effect.Effect<void, unknown>;

export interface QuestsShape {
  abandon(questId: number): BridgeEffect<void>;
  accept(questId: number, silent?: boolean): BridgeEffect<void>;
  canComplete(questId: number): BridgeEffect<boolean>;
  complete(
    questId: number,
    turnIns?: number,
    itemId?: number,
    special?: boolean,
  ): BridgeEffect<boolean>;
  getMaxTurnIns(questId: number): BridgeEffect<number>;
  load(questId: number, silent?: boolean): BridgeEffect<void>;
  loadMany(questIds: number[], silent?: boolean): BridgeEffect<void>;
  getAll(): Effect.Effect<Collection<number, Quest>>;
  get(questId: number): Effect.Effect<Option.Option<Quest>>;
  onLoaded(listener: QuestLoadedListener): Effect.Effect<() => void>;
  has(questId: number): Effect.Effect<boolean>;
  getAccepted(): BridgeEffect<Quest[]>;
  isAvailable(questId: number): BridgeEffect<boolean>;
  isInProgress(questId: number): BridgeEffect<boolean>;
}

export class Quests extends ServiceMap.Service<Quests, QuestsShape>()(
  "flash/Services/Quests",
) {}
