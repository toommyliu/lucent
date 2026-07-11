import { Effect, Option, Schema } from "effect";

import type { BridgeService } from "../bridge/Bridge";
import { PositiveWireInt, WireInt } from "../contract/Coercion";
import type { Store } from "../state/Store";
import type { Wait } from "./Wait";

const QuestIds = Schema.Array(PositiveWireInt);
const decodeQuestId = Schema.decodeUnknownOption(PositiveWireInt);

export const makeQuests = (bridge: BridgeService, store: Store, wait: Wait) => {
  const load = (input: unknown) => {
    const questId = decodeQuestId(input);
    if (Option.isNone(questId)) return Effect.succeed(false);
    return store.quests.get(questId.value).pipe(
      Effect.flatMap((current) =>
        current !== null
          ? Effect.succeed(true)
          : bridge.invoke("quests.load", [questId.value], Schema.Void).pipe(
              Effect.flatMap(
                Option.match({
                  onNone: () => Effect.succeed(false),
                  onSome: () =>
                    wait.until(
                      store.quests
                        .get(questId.value)
                        .pipe(Effect.map((quest) => quest !== null)),
                      { timeout: "5 seconds" },
                    ),
                }),
              ),
            ),
      ),
    );
  };

  const isInProgress = (input: unknown) => {
    const questId = decodeQuestId(input);
    return Option.isNone(questId)
      ? Effect.succeed(false)
      : bridge
          .invoke("quests.isInProgress", [questId.value], Schema.Boolean)
          .pipe(Effect.map(Option.getOrElse(() => false)));
  };

  const accept = (input: unknown) => {
    const questId = decodeQuestId(input);
    if (Option.isNone(questId)) return Effect.succeed(false);
    return Effect.gen(function* () {
      if (
        (yield* store.quests.get(questId.value)) === null &&
        !(yield* load(questId.value))
      ) {
        return false;
      }
      if (yield* isInProgress(questId.value)) return true;
      if (!(yield* wait.forGameAction("acceptQuest"))) return false;
      const accepted = yield* bridge
        .invoke("quests.accept", [questId.value], Schema.Boolean)
        .pipe(Effect.map(Option.getOrElse(() => false)));
      return accepted
        ? yield* wait.until(isInProgress(questId.value), {
            timeout: "5 seconds",
          })
        : false;
    });
  };

  const abandon = (input: unknown) => {
    const questId = decodeQuestId(input);
    if (Option.isNone(questId)) return Effect.succeed(false);
    return Effect.gen(function* () {
      if (!(yield* isInProgress(questId.value))) return false;
      if (
        Option.isNone(
          yield* bridge.invoke("quests.abandon", [questId.value], Schema.Void),
        )
      ) {
        return false;
      }
      return yield* wait.until(
        isInProgress(questId.value).pipe(Effect.map((active) => !active)),
        { timeout: "5 seconds" },
      );
    });
  };

  const acceptBatch = (inputs: readonly unknown[]) =>
    Effect.forEach(inputs, accept, { concurrency: 1 });

  const getMaxTurnIns = (input: unknown) => {
    const questId = decodeQuestId(input);
    return Option.isNone(questId)
      ? Effect.succeed(1)
      : bridge.invoke("quests.getMaxTurnIns", [questId.value], WireInt).pipe(
          Effect.map(
            Option.match({
              onNone: () => 1,
              onSome: (turnIns) => Math.max(1, turnIns),
            }),
          ),
        );
  };

  const complete = (
    input: unknown,
    requestedTurnIns?: number,
    itemId = -1,
    special = false,
  ) => {
    const questId = decodeQuestId(input);
    if (Option.isNone(questId)) return Effect.succeed(false);
    return Effect.gen(function* () {
      if (!(yield* isInProgress(questId.value))) return false;
      if (
        !(yield* wait.forGameAction("tryQuestComplete", {
          timeout: "5 seconds",
        }))
      ) {
        return false;
      }
      const turnIns =
        requestedTurnIns === undefined || !Number.isFinite(requestedTurnIns)
          ? yield* getMaxTurnIns(questId.value)
          : Math.max(1, Math.trunc(requestedTurnIns));
      const event = yield* wait.forEvent(
        { questId: questId.value, type: "quest-complete" },
        {
          timeout: "5 seconds",
          trigger: bridge.invoke(
            "quests.complete",
            [questId.value, turnIns, itemId, special],
            Schema.Void,
          ),
        },
      );
      return event !== null;
    });
  };

  const get = (input: unknown) => {
    const questId = decodeQuestId(input);
    return Option.isNone(questId)
      ? Effect.succeed(null)
      : store.quests
          .get(questId.value)
          .pipe(
            Effect.flatMap((quest) =>
              quest !== null
                ? Effect.succeed(quest)
                : load(questId.value).pipe(
                    Effect.andThen(store.quests.get(questId.value)),
                  ),
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

  const isAvailable = (input: unknown) => {
    const questId = decodeQuestId(input);
    return Option.isNone(questId)
      ? Effect.succeed(false)
      : bridge
          .invoke("quests.isAvailable", [questId.value], Schema.Boolean)
          .pipe(Effect.map(Option.getOrElse(() => false)));
  };

  const loadBatch = (inputs: readonly unknown[]) => {
    const ids = Array.from(
      new Set(
        inputs.flatMap((input) => {
          const decoded = decodeQuestId(input);
          return Option.isSome(decoded) ? [decoded.value] : [];
        }),
      ),
    );
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
