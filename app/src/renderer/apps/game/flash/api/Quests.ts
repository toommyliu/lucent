import * as Array from "effect/Array";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import type { BridgeService } from "../bridge/Bridge";
import { PositiveWireInt, WireInt } from "../contract/Coercion";
import type { Store } from "../state/Store";
import type { Wait } from "./Wait";

const QuestIds = Schema.Array(PositiveWireInt);

const isQuestId = (questId: number): boolean =>
  Number.isSafeInteger(questId) && questId > 0;

export interface CompleteQuestOptions {
  /** Number of turn-ins to complete. Must be finite. Omit to use the maximum currently possible. */
  readonly turnIns?: number;
  /** Preferred reward item. Omit when no specific reward is requested. */
  readonly rewardItemId?: number;
}

export const makeQuests = (bridge: BridgeService, store: Store, wait: Wait) => {
  const loads = Semaphore.makeUnsafe(1);
  let nextLoadAt = 0;
  const isLoaded = (questId: number) =>
    store.quests.get(questId).pipe(Effect.map((quest) => quest !== null));

  // Call under `loads` so single and batch requests share the same cooldown.
  const waitForLoadSlot = Effect.gen(function* () {
    const delay = nextLoadAt - (yield* Clock.currentTimeMillis);
    if (delay > 0) yield* Effect.sleep(delay);
    nextLoadAt = (yield* Clock.currentTimeMillis) + 1_500;
  });

  const requestBatch = Effect.fn("Quests.requestBatch")(
    function* (questIds: readonly number[], silent: boolean) {
      const missing = yield* Effect.filter(questIds, (id) =>
        isLoaded(id).pipe(Effect.map((loaded) => !loaded)),
      );
      if (missing.length === 0) return true;
      yield* waitForLoadSlot;
      yield* bridge
        .invoke(
          silent ? "quests.getMultiple" : "quests.loadMultiple",
          [missing.join(",")],
          Schema.Void,
        )
        .pipe(Effect.flatMap(Effect.fromOption));
      return yield* wait.until(
        Effect.forEach(missing, isLoaded).pipe(
          Effect.map((results) => results.every(Boolean)),
        ),
        { timeout: "5 seconds" },
      );
    },
    Effect.catch(() => Effect.succeed(false)),
    Effect.repeat({ times: 1, until: Boolean }),
  );

  const loadBatch = Effect.fn("Quests.loadBatch")(function* (
    questIds: readonly number[],
    silent = false,
  ) {
    const ids = Array.dedupe(questIds.filter(isQuestId));
    const initial = yield* Effect.forEach(ids, isLoaded);
    if (initial.every(Boolean)) return initial;
    yield* Effect.forEach(
      Array.chunksOf(ids, 30),
      (batch) => requestBatch(batch, silent),
      { concurrency: 1, discard: true },
    ).pipe(loads.withPermit);
    return yield* Effect.forEach(ids, isLoaded);
  });

  const load = (questId: number, silent = false) =>
    loadBatch([questId], silent).pipe(
      Effect.map((loaded) => loaded[0] ?? false),
    );

  const isInProgress = (questId: number) => {
    if (!isQuestId(questId)) return Effect.succeed(false);
    return bridge
      .invoke("quests.isInProgress", [questId], Schema.Boolean)
      .pipe(Effect.map(Option.getOrElse(() => false)));
  };

  const canComplete = (questId: number) => {
    if (!isQuestId(questId)) return Effect.succeed(false);
    return bridge
      .invoke("quests.canComplete", [questId], Schema.Boolean)
      .pipe(Effect.map(Option.getOrElse(() => false)));
  };

  const accept = (questId: number, silent = false) => {
    if (!isQuestId(questId)) return Effect.succeed(false);
    return Effect.gen(function* () {
      let actionAvailable = false;
      if ((yield* store.quests.get(questId)) === null) {
        actionAvailable = yield* wait.forGameAction("acceptQuest");
        if (!actionAvailable || !(yield* load(questId, silent))) return false;
      }
      if (yield* isInProgress(questId)) return true;
      if (!actionAvailable && !(yield* wait.forGameAction("acceptQuest")))
        return false;
      const accepted = yield* bridge
        .invoke("quests.accept", [questId, silent], Schema.Boolean)
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

  const acceptBatch = (questIds: readonly number[], silent = false) =>
    Effect.forEach(questIds, (questId) => accept(questId, silent), {
      concurrency: 1,
    });

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

  const complete = (questId: number, options?: CompleteQuestOptions) => {
    if (!isQuestId(questId)) return Effect.succeed(false);
    if (options?.turnIns !== undefined && !Number.isFinite(options.turnIns)) {
      return Effect.succeed(false);
    }
    return Effect.gen(function* () {
      if (!(yield* isInProgress(questId))) return false;
      if (!(yield* canComplete(questId))) return false;
      if (
        !(yield* wait.forGameAction("tryQuestComplete", {
          timeout: "5 seconds",
        }))
      ) {
        return false;
      }
      const turnIns =
        options?.turnIns === undefined
          ? yield* getMaxTurnIns(questId)
          : Math.max(1, Math.trunc(options.turnIns));
      const event = yield* wait.forEvent(
        { questId, type: "quest-complete" },
        {
          timeout: "5 seconds",
          trigger: bridge
            .invoke(
              "quests.complete",
              [questId, turnIns, options?.rewardItemId ?? -1, false],
              Schema.Void,
            )
            .pipe(Effect.map(Option.isSome)),
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

  return {
    abandon,
    accept,
    acceptBatch,
    canComplete,
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
