import { Effect, Option, Schema } from "effect";

import type { BridgeService } from "../bridge/Bridge";
import { PositiveWireInt, WireInt } from "../contract/Coercion";
import type { Store } from "../state/Store";
import type { Wait } from "./Wait";

const QuestIds = Schema.Array(PositiveWireInt);

const isQuestId = (questId: number): boolean =>
  Number.isSafeInteger(questId) && questId > 0;

export const makeQuests = (bridge: BridgeService, store: Store, wait: Wait) => {
  const load = (questId: number) => {
    if (!isQuestId(questId)) return Effect.succeed(false);
    return store.quests.get(questId).pipe(
      Effect.flatMap((current) =>
        current !== null
          ? Effect.succeed(true)
          : bridge.invoke("quests.load", [questId], Schema.Void).pipe(
              Effect.flatMap(
                Option.match({
                  onNone: () => Effect.succeed(false),
                  onSome: () =>
                    wait.until(
                      store.quests
                        .get(questId)
                        .pipe(Effect.map((quest) => quest !== null)),
                      { timeout: "5 seconds" },
                    ),
                }),
              ),
            ),
      ),
    );
  };

  const isInProgress = (questId: number) => {
    if (!isQuestId(questId)) return Effect.succeed(false);
    return bridge
      .invoke("quests.isInProgress", [questId], Schema.Boolean)
      .pipe(Effect.map(Option.getOrElse(() => false)));
  };

  const accept = (questId: number) => {
    if (!isQuestId(questId)) return Effect.succeed(false);
    return Effect.gen(function* () {
      if (
        (yield* store.quests.get(questId)) === null &&
        !(yield* load(questId))
      ) {
        return false;
      }
      if (yield* isInProgress(questId)) return true;
      if (!(yield* wait.forGameAction("acceptQuest"))) return false;
      const accepted = yield* bridge
        .invoke("quests.accept", [questId], Schema.Boolean)
        .pipe(Effect.map(Option.getOrElse(() => false)));
      return accepted
        ? yield* wait.until(isInProgress(questId), {
            timeout: "5 seconds",
          })
        : false;
    });
  };

  const abandon = (questId: number) => {
    if (!isQuestId(questId)) return Effect.succeed(false);
    return Effect.gen(function* () {
      if (!(yield* isInProgress(questId))) return false;
      if (
        Option.isNone(
          yield* bridge.invoke("quests.abandon", [questId], Schema.Void),
        )
      ) {
        return false;
      }
      return yield* wait.until(
        isInProgress(questId).pipe(Effect.map((active) => !active)),
        { timeout: "5 seconds" },
      );
    });
  };

  const acceptBatch = (questIds: readonly number[]) =>
    Effect.forEach(questIds, accept, { concurrency: 1 });

  const getMaxTurnIns = (questId: number) => {
    if (!isQuestId(questId)) return Effect.succeed(1);
    return bridge.invoke("quests.getMaxTurnIns", [questId], WireInt).pipe(
      Effect.map(
        Option.match({
          onNone: () => 1,
          onSome: (turnIns) => Math.max(1, turnIns),
        }),
      ),
    );
  };

  const complete = (
    questId: number,
    requestedTurnIns?: number,
    itemId = -1,
    special = false,
  ) => {
    if (!isQuestId(questId)) return Effect.succeed(false);
    return Effect.gen(function* () {
      if (!(yield* isInProgress(questId))) return false;
      if (
        !(yield* wait.forGameAction("tryQuestComplete", {
          timeout: "5 seconds",
        }))
      ) {
        return false;
      }
      const turnIns =
        requestedTurnIns === undefined || !Number.isFinite(requestedTurnIns)
          ? yield* getMaxTurnIns(questId)
          : Math.max(1, Math.trunc(requestedTurnIns));
      const event = yield* wait.forEvent(
        { questId, type: "quest-complete" },
        {
          timeout: "5 seconds",
          trigger: bridge.invoke(
            "quests.complete",
            [questId, turnIns, itemId, special],
            Schema.Void,
          ),
        },
      );
      return event !== null;
    });
  };

  const get = (questId: number) => {
    if (!isQuestId(questId)) return Effect.succeed(null);
    return store.quests
      .get(questId)
      .pipe(
        Effect.flatMap((quest) =>
          quest !== null
            ? Effect.succeed(quest)
            : load(questId).pipe(Effect.andThen(store.quests.get(questId))),
        ),
      );
  };

  const getAccepted = () =>
    bridge.invoke("quests.getAccepted", undefined, QuestIds).pipe(
      Effect.flatMap(
        Option.match({
          onNone: () => store.quests.getAccepted,
          onSome: (ids) =>
            store.quests
              .setAccepted(ids)
              .pipe(Effect.andThen(store.quests.getAccepted)),
        }),
      ),
    );

  const getAll = () => store.quests.getAll;

  const isAvailable = (questId: number) => {
    if (!isQuestId(questId)) return Effect.succeed(false);
    return bridge
      .invoke("quests.isAvailable", [questId], Schema.Boolean)
      .pipe(Effect.map(Option.getOrElse(() => false)));
  };

  const loadBatch = (questIds: readonly number[]) => {
    const ids = Array.from(new Set(questIds.filter(isQuestId)));
    if (ids.length === 0) return Effect.succeed([]);
    return Effect.gen(function* () {
      const initial = yield* Effect.forEach(ids, (id) =>
        store.quests.get(id).pipe(Effect.map((quest) => quest !== null)),
      );
      if (!initial.every(Boolean)) {
        if (
          Option.isSome(
            yield* bridge.invoke(
              "quests.loadMultiple",
              [ids.join(",")],
              Schema.Void,
            ),
          )
        ) {
          yield* wait.until(
            Effect.forEach(ids, store.quests.get).pipe(
              Effect.map((quests) => quests.every((quest) => quest !== null)),
            ),
            { timeout: "5 seconds" },
          );
        }
      }
      return yield* Effect.forEach(ids, (id) =>
        store.quests.get(id).pipe(Effect.map((quest) => quest !== null)),
      );
    });
  };

  return {
    abandon,
    accept,
    acceptBatch,
    complete,
    get,
    getAccepted,
    getAll,
    getMaxTurnIns,
    isAvailable,
    isInProgress,
    load,
    loadBatch,
  };
};

export type Quests = ReturnType<typeof makeQuests>;
