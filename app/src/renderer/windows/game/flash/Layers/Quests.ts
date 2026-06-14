import { Collection } from "@lucent/collection";
import { Quest, type QuestInfo } from "@lucent/game";
import { Deferred, Effect, Layer, Option, SynchronizedRef } from "effect";
import { asNumber, asRecord } from "../PacketPayload";
import { positiveInt, uniquePositiveInts } from "@lucent/shared/number";
import { Bridge } from "../Services/Bridge";
import type { BridgeEffect } from "../Services/Bridge";
import { Packet } from "../Services/Packet";
import { Quests } from "../Services/Quests";
import type { QuestLoadedListener, QuestsShape } from "../Services/Quests";
import { Wait } from "../Services/Wait";

const asQuestMap = (value: unknown): Record<string, QuestInfo> | null => {
  const payload = asRecord(value);
  if (!payload) {
    return null;
  }

  const quests = asRecord(payload["quests"]);
  if (!quests) {
    return null;
  }

  return quests as Record<string, QuestInfo>;
};

const toQuestId = (value: unknown): number | undefined => {
  const parsed = asNumber(value);
  if (parsed === undefined) {
    return undefined;
  }

  return positiveInt(parsed);
};

const normalizeQuestIds = (questIds: readonly number[]): number[] =>
  uniquePositiveInts(questIds);

const QUEST_LOAD_TIMEOUT = "5 seconds";
const QUEST_ACCEPT_TIMEOUT = "5 seconds";
const QUEST_COMPLETE_TIMEOUT = "5 seconds";

interface QuestCompleteResponse {
  readonly questId?: number;
  readonly success: boolean;
}

const asQuestCompleteResponse = (
  value: unknown,
): QuestCompleteResponse | undefined => {
  const payload = asRecord(value);
  if (!payload) {
    return undefined;
  }

  const bSuccess = asNumber(payload["bSuccess"]);
  if (bSuccess === undefined) {
    return undefined;
  }

  const questId = toQuestId(payload["QuestID"]);

  return {
    ...(questId !== undefined ? { questId } : null),
    success: bSuccess === 1,
  };
};

const responseMatchesQuestComplete = (
  response: QuestCompleteResponse,
  questId: number,
): boolean => {
  if (response.questId !== undefined) {
    return response.questId === questId;
  }

  return !response.success;
};

const make = Effect.gen(function* () {
  const bridge = yield* Bridge;
  const packets = yield* Packet;
  const wait = yield* Wait;

  const quests = yield* SynchronizedRef.make<Collection<number, Quest>>(
    new Collection(),
  );
  const questLoadedListeners = new Set<QuestLoadedListener>();

  const runFork = Effect.runFork;

  const dispose = yield* bridge.onConnection((status) => {
    if (status === "OnConnectionLost") {
      runFork(
        SynchronizedRef.update(quests, (tree) => {
          tree.clear();
          return tree;
        }),
      );
    }
  });

  yield* Effect.addFinalizer(() => Effect.sync(dispose));

  const updateQuests = (value: unknown) =>
    Effect.gen(function* () {
      const nextQuests = asQuestMap(value);
      if (!nextQuests) {
        return;
      }

      const loadedQuestIds: number[] = [];
      yield* SynchronizedRef.update(quests, (tree) => {
        for (const [rawQuestId, questInfo] of Object.entries(nextQuests)) {
          const questId = toQuestId(rawQuestId);
          if (questId === undefined) {
            continue;
          }

          tree.ensure(questId, () => new Quest(questInfo)).data = questInfo;
          loadedQuestIds.push(questId);
        }

        return tree;
      });

      if (loadedQuestIds.length === 0 || questLoadedListeners.size === 0) {
        return;
      }

      const listeners = Array.from(questLoadedListeners);
      yield* Effect.forEach(
        listeners,
        (listener, listenerIndex) =>
          listener(loadedQuestIds).pipe(
            Effect.catchCause((cause) =>
              Effect.logError({
                message: "quest loaded listener failed",
                questIds: loadedQuestIds,
                listenerIndex,
                cause,
              }),
            ),
          ),
        { discard: true },
      );
    });

  yield* packets.jsonScoped("getQuests", (packet) => updateQuests(packet.data));

  const waitForQuestLoad = (questId: number) =>
    wait.until(
      SynchronizedRef.get(quests).pipe(Effect.map((tree) => tree.has(questId))),
      { timeout: QUEST_LOAD_TIMEOUT },
    );

  const waitForQuestAccept = (questId: number) =>
    wait.until(isInProgress(questId), { timeout: QUEST_ACCEPT_TIMEOUT });

  const confirmQuestCompleteResponse = (
    questId: number,
    request: BridgeEffect<void>,
  ) =>
    Effect.gen(function* () {
      const result = yield* Deferred.make<QuestCompleteResponse>();
      const dispose = yield* packets.json("ccqr", (packet) =>
        Effect.gen(function* () {
          const response = asQuestCompleteResponse(packet.data);
          if (
            response === undefined ||
            !responseMatchesQuestComplete(response, questId)
          ) {
            return;
          }

          yield* Deferred.succeed(result, response).pipe(Effect.asVoid);
        }),
      );

      return yield* Effect.gen(function* () {
        yield* request;
        return yield* Deferred.await(result).pipe(
          Effect.timeoutOption(QUEST_COMPLETE_TIMEOUT),
        );
      }).pipe(Effect.ensuring(Effect.sync(dispose)));
    });

  const abandon: QuestsShape["abandon"] = (questId) =>
    bridge.call("quests.abandon", [questId]);

  const accept: QuestsShape["accept"] = (questId, silent = false) =>
    Effect.gen(function* () {
      const canAccept = yield* wait.forGameAction("acceptQuest");
      if (!canAccept) {
        return;
      }

      const tree = yield* SynchronizedRef.get(quests);
      if (!tree.get(questId)) {
        yield* load(questId, silent);
        const updatedTree = yield* SynchronizedRef.get(quests);
        if (!updatedTree.get(questId)) {
          return;
        }
      }

      if (yield* isInProgress(questId)) {
        return;
      }

      const sent = yield* bridge.call("quests.accept", [questId]);
      if (!sent) {
        yield* Effect.logWarning({
          message: "quest accept skipped: action unavailable",
          questId,
        });
        return;
      }

      yield* waitForQuestAccept(questId);
    });

  const canComplete: QuestsShape["canComplete"] = (questId) =>
    bridge.call("quests.canComplete", [questId]);

  const complete: QuestsShape["complete"] = (
    questId,
    turnIns?: number,
    itemId = -1,
    special = false,
  ) =>
    Effect.gen(function* () {
      const turnInsNumber = turnIns ?? (yield* getMaxTurnIns(questId));
      const actionAvailable = yield* wait.forGameAction("tryQuestComplete", {
        timeout: QUEST_COMPLETE_TIMEOUT,
      });
      if (!actionAvailable) {
        yield* Effect.logWarning({
          message: "quest complete skipped: action unavailable",
          questId,
          turnIns: turnInsNumber,
        });
        return false;
      }

      const response = yield* confirmQuestCompleteResponse(
        questId,
        bridge.call("quests.complete", [
          questId,
          turnInsNumber,
          itemId,
          special,
        ]),
      );
      if (Option.isNone(response)) {
        yield* Effect.logWarning({
          message: "quest complete response timed out or request was not sent",
          questId,
          turnIns: turnInsNumber,
        });
        return false;
      }

      if (!response.value.success) {
        yield* Effect.logWarning({
          message: "quest complete rejected",
          questId,
          turnIns: turnInsNumber,
        });
      }

      return response.value.success;
    });

  const getMaxTurnIns: QuestsShape["getMaxTurnIns"] = (questId) =>
    Effect.map(
      bridge.call("quests.getMaxTurnIns", [questId]),
      (turnIns) => positiveInt(Number(turnIns)) ?? 1,
    );

  const load: QuestsShape["load"] = (questId, silent = false) =>
    Effect.gen(function* () {
      if (silent) {
        yield* bridge.call("quests.get", [questId]);
      } else {
        yield* bridge.call("quests.load", [questId]);
      }

      yield* waitForQuestLoad(questId).pipe(Effect.asVoid);
    });

  const loadMany: QuestsShape["loadMany"] = (questIds, silent = false) => {
    const normalizedQuestIds = normalizeQuestIds(questIds);
    if (normalizedQuestIds.length === 0) {
      return Effect.void;
    }

    if (silent) {
      return Effect.gen(function* () {
        yield* bridge.call("quests.getMultiple", [
          normalizedQuestIds.join(","),
        ]);
        yield* Effect.forEach(
          normalizedQuestIds,
          (questId) => waitForQuestLoad(questId).pipe(Effect.asVoid),
          { concurrency: "unbounded" },
        );
      });
    }

    return Effect.asVoid(
      Effect.forEach(normalizedQuestIds, (questId) => load(questId, false)),
    );
  };

  const getAll: QuestsShape["getAll"] = () => SynchronizedRef.get(quests);

  const get: QuestsShape["get"] = (questId) =>
    SynchronizedRef.get(quests).pipe(
      Effect.map((tree) => {
        const quest = tree.get(questId);
        return quest === undefined ? Option.none() : Option.some(quest);
      }),
    );

  const onLoaded: QuestsShape["onLoaded"] = (listener) =>
    Effect.sync(() => {
      questLoadedListeners.add(listener);

      return () => {
        questLoadedListeners.delete(listener);
      };
    });

  const has: QuestsShape["has"] = (questId) =>
    SynchronizedRef.get(quests).pipe(Effect.map((tree) => tree.has(questId)));

  const getAccepted: QuestsShape["getAccepted"] = () =>
    Effect.gen(function* () {
      const rawQuestIds = yield* bridge.call("quests.getAccepted");
      const questIds = Array.isArray(rawQuestIds)
        ? rawQuestIds
            .map(toQuestId)
            .filter((id): id is number => id !== undefined)
        : [];

      const tree = yield* SynchronizedRef.get(quests);
      return questIds
        .map((id) => tree.get(id))
        .filter((q): q is Quest => q !== undefined);
    });

  const isAvailable: QuestsShape["isAvailable"] = (questId) =>
    bridge.call("quests.isAvailable", [questId]);

  const isInProgress: QuestsShape["isInProgress"] = (questId) =>
    bridge.call("quests.isInProgress", [questId]);

  return {
    abandon,
    accept,
    canComplete,
    complete,
    getMaxTurnIns,
    load,
    loadMany,
    getAll,
    get,
    onLoaded,
    has,
    getAccepted,
    isAvailable,
    isInProgress,
  } satisfies QuestsShape;
});

export const QuestsLive = Layer.effect(Quests, make);
