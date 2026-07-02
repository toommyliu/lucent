import { Context, Effect, Layer } from "effect";

import type { QuestRecord } from "../Types";
import { SwfBridge } from "../SwfBridge";
import { asBoolean, asPositiveInt, asRecord } from "../payload";
import { FlashProtocol } from "../protocol/FlashProtocol";
import { QuestsState } from "../state/Quests";
import { WaitApi } from "./Wait";

export interface QuestsApiShape {
  readonly abandon: (questId: number) => Effect.Effect<void>;
  readonly accept: (questId: number) => Effect.Effect<boolean>;
  readonly acceptBatch: (
    questIds: readonly number[],
  ) => Effect.Effect<readonly boolean[]>;
  readonly complete: (
    questId: number,
    turnIns?: number,
    itemId?: number,
    special?: boolean,
  ) => Effect.Effect<boolean>;
  readonly get: (questId: number) => Effect.Effect<QuestRecord | null>;
  readonly getAccepted: () => Effect.Effect<readonly QuestRecord[]>;
  readonly getAll: () => Effect.Effect<readonly QuestRecord[]>;
  readonly getMaxTurnIns: (questId: number) => Effect.Effect<number>;
  readonly isAvailable: (questId: number) => Effect.Effect<boolean>;
  readonly isInProgress: (questId: number) => Effect.Effect<boolean>;
  readonly load: (questId: number) => Effect.Effect<boolean>;
  readonly loadBatch: (
    questIds: readonly number[],
  ) => Effect.Effect<readonly boolean[]>;
}

export class QuestsApi extends Context.Service<QuestsApi, QuestsApiShape>()(
  "lucent/game/flash/api/Quests",
) {}

const normalizeQuestId = (questId: number): number | null =>
  Number.isFinite(questId) && questId > 0 ? Math.trunc(questId) : null;

const uniqueQuestIds = (questIds: readonly number[]): readonly number[] =>
  Array.from(
    new Set(
      questIds
        .map(normalizeQuestId)
        .filter((questId): questId is number => questId !== null),
    ),
  );

const allCached = (values: readonly boolean[]): boolean =>
  values.every(Boolean);

export const layer = Layer.effect(
  QuestsApi,
  Effect.gen(function* () {
    const bridge = yield* SwfBridge;
    const protocol = yield* FlashProtocol;
    const quests = yield* QuestsState;
    const wait = yield* WaitApi;

    const load: QuestsApiShape["load"] = (questId) =>
      Effect.gen(function* () {
        const id = normalizeQuestId(questId);
        if (id === null) {
          return false;
        }

        if (yield* quests.has(id)) {
          return true;
        }

        yield* bridge.call("quests.load", [id]);
        return yield* wait.until(quests.has(id), { timeout: "5 seconds" });
      });

    const accept: QuestsApiShape["accept"] = (questId) =>
      Effect.gen(function* () {
        const id = normalizeQuestId(questId);
        if (id === null) {
          return false;
        }

        if (!(yield* quests.has(id)) && !(yield* load(id))) {
          return false;
        }

        if (yield* bridge.call("quests.isInProgress", [id])) {
          return true;
        }

        const available = yield* wait.forGameAction("acceptQuest");
        if (!available) {
          return false;
        }

        const sent = yield* bridge.call("quests.accept", [id]);
        return sent
          ? yield* wait.until(bridge.call("quests.isInProgress", [id]), {
              timeout: "5 seconds",
            })
          : false;
      });

    const complete: QuestsApiShape["complete"] = (
      questId,
      turnIns,
      itemId = -1,
      special = false,
    ) =>
      Effect.gen(function* () {
        const id = normalizeQuestId(questId);
        if (id === null) {
          return false;
        }

        const normalizedTurnIns =
          turnIns === undefined || !Number.isFinite(turnIns)
            ? yield* getMaxTurnIns(id)
            : Math.max(1, Math.trunc(turnIns));
        const available = yield* wait.forGameAction("tryQuestComplete", {
          timeout: "5 seconds",
        });
        if (!available) {
          return false;
        }

        yield* bridge.call("quests.complete", [
          id,
          normalizedTurnIns,
          itemId,
          special,
        ]);
        const packet = yield* protocol.oncePacket(
          { command: "ccqr" },
          { timeout: "5 seconds" },
        );
        const payload =
          packet !== null && packet.direction !== "client"
            ? asRecord(packet.data)
            : null;
        const responseQuestId = asPositiveInt(payload?.["QuestID"]);
        return (
          packet !== null &&
          (responseQuestId === undefined || responseQuestId === id) &&
          asBoolean(payload?.["bSuccess"]) === true
        );
      });

    const getMaxTurnIns: QuestsApiShape["getMaxTurnIns"] = (questId) =>
      bridge
        .call("quests.getMaxTurnIns", [Math.max(1, Math.trunc(questId))])
        .pipe(
          Effect.map((turnIns) => Math.max(1, asPositiveInt(turnIns) ?? 1)),
        );

    return QuestsApi.of({
      abandon: (questId) =>
        normalizeQuestId(questId) === null
          ? Effect.void
          : bridge.call("quests.abandon", [Math.trunc(questId)]),
      accept,
      acceptBatch: (questIds) =>
        Effect.forEach(uniqueQuestIds(questIds), accept, { concurrency: 1 }),
      complete,
      get: (questId) =>
        normalizeQuestId(questId) === null
          ? Effect.succeed(null)
          : quests.get(Math.trunc(questId)),
      getAccepted: () =>
        bridge.call("quests.getAccepted").pipe(
          Effect.flatMap((rawQuestIds) =>
            Effect.forEach(
              Array.isArray(rawQuestIds)
                ? rawQuestIds
                    .map(asPositiveInt)
                    .filter((id): id is number => id !== undefined)
                : [],
              quests.get,
            ),
          ),
          Effect.map((accepted) =>
            accepted.filter((quest): quest is QuestRecord => quest !== null),
          ),
        ),
      getAll: quests.getAll,
      getMaxTurnIns,
      isAvailable: (questId) =>
        normalizeQuestId(questId) === null
          ? Effect.succeed(false)
          : bridge.call("quests.isAvailable", [Math.trunc(questId)]),
      isInProgress: (questId) =>
        normalizeQuestId(questId) === null
          ? Effect.succeed(false)
          : bridge.call("quests.isInProgress", [Math.trunc(questId)]),
      load,
      loadBatch: (questIds) =>
        Effect.gen(function* () {
          const ids = uniqueQuestIds(questIds);
          if (ids.length === 0) {
            return [];
          }

          const initial = yield* Effect.forEach(ids, quests.has);
          if (!allCached(initial)) {
            yield* bridge.call("quests.loadMultiple", [ids.join(",")]);
            yield* wait.until(
              Effect.forEach(ids, quests.has).pipe(Effect.map(allCached)),
              { timeout: "5 seconds" },
            );
          }

          return yield* Effect.forEach(ids, quests.has);
        }),
    });
  }),
);
