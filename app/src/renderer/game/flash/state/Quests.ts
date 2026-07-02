import { Context, Effect, Layer, SynchronizedRef } from "effect";

import type { QuestRecord } from "../Types";
import { asRecord, normalizeQuestRecord } from "../payload";

interface QuestsRuntimeState {
  readonly quests: Map<number, QuestRecord>;
}

export interface QuestsStateShape {
  readonly clear: () => Effect.Effect<void>;
  readonly get: (questId: number) => Effect.Effect<QuestRecord | null>;
  readonly getAll: () => Effect.Effect<readonly QuestRecord[]>;
  readonly has: (questId: number) => Effect.Effect<boolean>;
  readonly reduceGetQuests: (payload: unknown) => Effect.Effect<void>;
}

export class QuestsState extends Context.Service<
  QuestsState,
  QuestsStateShape
>()("lucent/game/flash/state/Quests") {}

export const layer = Layer.effect(
  QuestsState,
  Effect.gen(function* () {
    const ref = yield* SynchronizedRef.make<QuestsRuntimeState>({
      quests: new Map(),
    });

    return QuestsState.of({
      clear: () =>
        SynchronizedRef.update(ref, (state) => {
          state.quests.clear();
          return state;
        }),
      get: (questId) =>
        SynchronizedRef.get(ref).pipe(
          Effect.map((state) => state.quests.get(questId) ?? null),
        ),
      getAll: () =>
        SynchronizedRef.get(ref).pipe(
          Effect.map((state) => Array.from(state.quests.values())),
        ),
      has: (questId) =>
        SynchronizedRef.get(ref).pipe(
          Effect.map((state) => state.quests.has(questId)),
        ),
      reduceGetQuests: (payload) =>
        SynchronizedRef.update(ref, (state) => {
          const quests = asRecord(asRecord(payload)?.["quests"]);
          if (quests === null) {
            return state;
          }

          for (const [rawQuestId, rawQuest] of Object.entries(quests)) {
            const quest = normalizeQuestRecord(rawQuestId, rawQuest);
            if (quest !== null) {
              state.quests.set(quest.id, quest);
            }
          }
          return state;
        }),
    });
  }),
);
