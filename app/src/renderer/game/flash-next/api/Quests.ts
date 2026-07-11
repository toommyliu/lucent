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
    return bridge.invoke("quests.accept", [questId.value], Schema.Boolean).pipe(
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.succeed(false),
          onSome: (accepted) =>
            accepted
              ? wait.until(isInProgress(questId.value), {
                  timeout: "5 seconds",
                })
              : Effect.succeed(false),
        }),
      ),
    );
  };

  return {
    abandon: (input: unknown) => {
      const questId = decodeQuestId(input);
      return Option.isNone(questId)
        ? Effect.succeed(false)
        : bridge.invoke("quests.abandon", [questId.value], Schema.Void).pipe(
            Effect.flatMap(
              Option.match({
                onNone: () => Effect.succeed(false),
                onSome: () =>
                  wait
                    .until(
                      isInProgress(questId.value).pipe(Effect.map((v) => !v)),
                      { timeout: "5 seconds" },
                    )
                    .pipe(Effect.orElseSucceed(() => true)),
              }),
            ),
          );
    },
    accept,
    acceptBatch: (inputs: readonly unknown[]) =>
      Effect.forEach(inputs, accept, { concurrency: 1 }).pipe(
        Effect.map((results) => results.every(Boolean)),
      ),
    complete: (input: unknown, turnIns = 1, itemId = -1, special = false) => {
      const questId = decodeQuestId(input);
      if (Option.isNone(questId)) return Effect.succeed(false);
      return wait
        .forEvent(
          { type: "quest-complete" },
          {
            timeout: "10 seconds",
            trigger: bridge.invoke(
              "quests.complete",
              [questId.value, turnIns, itemId, special],
              Schema.Void,
            ),
          },
        )
        .pipe(
          Effect.map(
            (event) =>
              event?.type === "quest-complete" &&
              event.questId === questId.value,
          ),
        );
    },
    get: (input: unknown) => {
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
    },
    getAccepted: () =>
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
      ),
    getAll: () => store.quests.getAll,
    getMaxTurnIns: (input: unknown) => {
      const questId = decodeQuestId(input);
      return Option.isNone(questId)
        ? Effect.succeed(0)
        : bridge
            .invoke("quests.getMaxTurnIns", [questId.value], WireInt)
            .pipe(Effect.map(Option.getOrElse(() => 0)));
    },
    isAvailable: (input: unknown) => {
      const questId = decodeQuestId(input);
      return Option.isNone(questId)
        ? Effect.succeed(false)
        : bridge
            .invoke("quests.isAvailable", [questId.value], Schema.Boolean)
            .pipe(Effect.map(Option.getOrElse(() => false)));
    },
    isInProgress,
    load,
    loadBatch: (inputs: readonly unknown[]) => {
      const ids = inputs.flatMap((input) => {
        const decoded = decodeQuestId(input);
        return Option.isSome(decoded) ? [decoded.value] : [];
      });
      if (ids.length !== inputs.length) return Effect.succeed(false);
      return bridge
        .invoke("quests.loadMultiple", [ids.join(",")], Schema.Void)
        .pipe(
          Effect.flatMap(
            Option.match({
              onNone: () => Effect.succeed(false),
              onSome: () =>
                wait.until(
                  Effect.forEach(ids, store.quests.get).pipe(
                    Effect.map((quests) =>
                      quests.every((quest) => quest !== null),
                    ),
                  ),
                  { timeout: "10 seconds" },
                ),
            }),
          ),
        );
    },
  };
};

export type Quests = ReturnType<typeof makeQuests>;
