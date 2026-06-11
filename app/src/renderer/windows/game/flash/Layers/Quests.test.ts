import { Effect, Fiber, Layer } from "effect";
import { TestClock } from "effect/testing";
import { expect, test } from "vitest";
import type { QuestInfo } from "@lucent/game";
import { Bridge, type BridgeShape } from "../Services/Bridge";
import {
  Packet,
  type ExtensionPacketHandler,
  type PacketShape,
} from "../Services/Packet";
import { Quests, type QuestsShape } from "../Services/Quests";
import { QuestsLive } from "./Quests";
import { WaitLive } from "./Wait";

type EmitJsonPacket = (
  cmd: string,
  data: Record<string, unknown>,
) => Effect.Effect<void, unknown>;

const questInfo = (questId: number): QuestInfo =>
  ({
    QuestID: String(questId),
    RequiredItems: [],
    Rewards: [],
    oItems: {},
    oRewards: {},
    reward: [],
    sName: `Quest ${questId}`,
  }) as unknown as QuestInfo;

const makeQuestPacket = (cmd: string, data: Record<string, unknown>) =>
  ({
    type: "extension",
    raw: JSON.stringify({ dataObj: data, type: "json" }),
    packetType: "json",
    cmd,
    data,
  }) as const;

const withQuests = async <A>(
  bridge: BridgeShape,
  body: (
    quests: QuestsShape,
    emitJson: EmitJsonPacket,
  ) => Effect.Effect<A, unknown>,
  options?: { readonly testClock?: boolean },
): Promise<A> => {
  const jsonHandlers = new Map<string, Set<ExtensionPacketHandler>>();
  const registerJsonHandler = (
    cmd: string,
    handler: ExtensionPacketHandler,
  ): (() => void) => {
    const handlers = jsonHandlers.get(cmd) ?? new Set<ExtensionPacketHandler>();
    handlers.add(handler);
    jsonHandlers.set(cmd, handlers);

    return () => {
      handlers.delete(handler);
      if (handlers.size === 0) {
        jsonHandlers.delete(cmd);
      }
    };
  };
  const emitJson: EmitJsonPacket = (cmd, data) =>
    Effect.forEach(
      Array.from(jsonHandlers.get(cmd) ?? []),
      (handler) => handler(makeQuestPacket(cmd, data)).pipe(Effect.asVoid),
      { discard: true },
    );
  const packet = {
    json(cmd: string, handler: ExtensionPacketHandler) {
      return Effect.sync(() => registerJsonHandler(cmd, handler));
    },
    jsonScoped(cmd: string, handler: ExtensionPacketHandler) {
      registerJsonHandler(cmd, handler);
      return Effect.void as never;
    },
  } as unknown as PacketShape;
  const layer = QuestsLive.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(Bridge)(bridge),
        Layer.succeed(Packet)(packet),
        WaitLive.pipe(Layer.provide(Layer.succeed(Bridge)(bridge))),
      ),
    ),
  );

  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const quests = yield* Quests;
        return yield* body(quests, emitJson);
      }),
    ).pipe(
      Effect.provide(
        options?.testClock === true
          ? Layer.mergeAll(layer, TestClock.layer())
          : layer,
      ),
    ),
  );
};

test("silent loadMany waits until fetched quests are in the local tree", async () => {
  const jsonHandlers = new Map<string, Parameters<PacketShape["json"]>[1]>();
  const bridgeCalls: string[] = [];
  let loadManyCompleted = false;
  const loadedEvents: number[][] = [];

  const packet = {
    jsonScoped(cmd: string, handler: ExtensionPacketHandler) {
      jsonHandlers.set(cmd, handler);
      return Effect.void as never;
    },
  } as unknown as PacketShape;

  const bridge = {
    call(path) {
      bridgeCalls.push(path);
      return Effect.void as never;
    },
    callGameFunction() {
      return Effect.void;
    },
    onConnection() {
      return Effect.succeed(() => {});
    },
  } as BridgeShape;

  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const quests = yield* Quests;
        yield* quests.onLoaded((questIds) =>
          Effect.sync(() => {
            loadedEvents.push([...questIds]);
          }),
        );

        const fiber = yield* Effect.forkDetach(
          quests.loadMany([609], true).pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                loadManyCompleted = true;
              }),
            ),
          ),
          { startImmediately: true },
        );

        yield* Effect.sleep("20 millis");
        expect(loadManyCompleted).toBe(false);
        expect(bridgeCalls).toEqual(["quests.getMultiple"]);

        const handler = jsonHandlers.get("getQuests");
        expect(handler).toBeDefined();
        if (handler === undefined) {
          return;
        }

        yield* handler({
          type: "extension",
          raw: "",
          packetType: "json",
          cmd: "getQuests",
          data: {
            quests: {
              609: questInfo(609),
            },
          },
        });

        yield* Fiber.join(fiber);
        expect(loadManyCompleted).toBe(true);
        expect(loadedEvents).toEqual([[609]]);
        expect((yield* quests.getAll()).has(609)).toBe(true);
      }),
    ).pipe(
      Effect.provide(
        QuestsLive.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(Bridge)(bridge),
              Layer.succeed(Packet)(packet),
              WaitLive.pipe(Layer.provide(Layer.succeed(Bridge)(bridge))),
            ),
          ),
        ),
      ),
    ),
  );
});

test("accept does not resend when quest is already in progress", async () => {
  const bridgeCalls: Array<{
    readonly path: string;
    readonly args?: unknown[];
  }> = [];
  const bridge = {
    call(path, args) {
      bridgeCalls.push(
        args === undefined
          ? { path: String(path) }
          : { path: String(path), args },
      );
      if (path === "world.isActionAvailable") {
        return Effect.succeed(true) as never;
      }

      if (path === "quests.isInProgress") {
        return Effect.succeed(true) as never;
      }

      return Effect.void as never;
    },
    callGameFunction() {
      return Effect.void;
    },
    onConnection() {
      return Effect.succeed(() => {});
    },
  } as BridgeShape;

  await withQuests(bridge, (quests, emitJson) =>
    Effect.gen(function* () {
      yield* emitJson("getQuests", {
        quests: {
          2330: questInfo(2_330),
        },
      });

      yield* quests.accept(2_330, true);
    }),
  );

  expect(bridgeCalls).toContainEqual({
    path: "world.isActionAvailable",
    args: ["acceptQuest"],
  });
  expect(bridgeCalls).toContainEqual({
    path: "quests.isInProgress",
    args: [2_330],
  });
  expect(bridgeCalls).not.toContainEqual({
    path: "quests.accept",
    args: [2_330],
  });
});

test("complete waits for matching ccqr response before returning", async () => {
  const bridgeCalls: Array<{
    readonly path: string;
    readonly args?: unknown[];
  }> = [];
  let completed = false;
  const bridge = {
    call(path, args) {
      bridgeCalls.push(
        args === undefined
          ? { path: String(path) }
          : { path: String(path), args },
      );
      if (path === "world.isActionAvailable") {
        return Effect.succeed(true) as never;
      }

      if (path === "quests.complete") {
        return Effect.void as never;
      }

      return Effect.void as never;
    },
    callGameFunction() {
      return Effect.void;
    },
    onConnection() {
      return Effect.succeed(() => {});
    },
  } as BridgeShape;

  await withQuests(bridge, (quests, emitJson) =>
    Effect.gen(function* () {
      const fiber = yield* Effect.forkDetach(
        quests.complete(2_330, 5).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              completed = true;
            }),
          ),
        ),
        { startImmediately: true },
      );

      yield* Effect.yieldNow;
      expect(bridgeCalls).toEqual([
        {
          path: "world.isActionAvailable",
          args: ["tryQuestComplete"],
        },
        {
          path: "quests.complete",
          args: [2_330, 5, -1, false],
        },
      ]);
      expect(completed).toBe(false);

      yield* emitJson("ccqr", {
        QuestID: 999,
        bSuccess: 1,
        cmd: "ccqr",
      });
      yield* Effect.yieldNow;
      expect(completed).toBe(false);

      yield* emitJson("ccqr", {
        QuestID: 2_330,
        bSuccess: 1,
        cmd: "ccqr",
      });
      const result = yield* Fiber.join(fiber);
      expect(completed).toBe(true);
      expect(result).toBe(true);
    }),
  );
});

test("complete eventually returns when ccqr response is missing", async () => {
  const bridge = {
    call(path) {
      if (path === "world.isActionAvailable") {
        return Effect.succeed(true) as never;
      }

      if (path === "quests.complete") {
        return Effect.void as never;
      }

      return Effect.void as never;
    },
    callGameFunction() {
      return Effect.void;
    },
    onConnection() {
      return Effect.succeed(() => {});
    },
  } as BridgeShape;

  const completed = await withQuests(
    bridge,
    (quests) =>
      Effect.gen(function* () {
        const fiber = yield* Effect.forkDetach(quests.complete(2_330, 5), {
          startImmediately: true,
        });
        yield* Effect.yieldNow;
        yield* TestClock.adjust("6 seconds");
        return yield* Fiber.join(fiber);
      }),
    { testClock: true },
  );

  expect(completed).toBe(false);
});

test("complete does not send when quest complete action is unavailable", async () => {
  const bridgeCalls: Array<{
    readonly path: string;
    readonly args?: unknown[];
  }> = [];
  const bridge = {
    call(path, args) {
      bridgeCalls.push(
        args === undefined
          ? { path: String(path) }
          : { path: String(path), args },
      );
      if (path === "world.isActionAvailable") {
        return Effect.succeed(false) as never;
      }

      if (path === "quests.complete") {
        return Effect.void as never;
      }

      return Effect.void as never;
    },
    callGameFunction() {
      return Effect.void;
    },
    onConnection() {
      return Effect.succeed(() => {});
    },
  } as BridgeShape;

  const result = await withQuests(
    bridge,
    (quests) =>
      Effect.gen(function* () {
        const fiber = yield* Effect.forkDetach(quests.complete(2_330, 1), {
          startImmediately: true,
        });
        yield* Effect.yieldNow;
        yield* TestClock.adjust("6 seconds");
        return yield* Fiber.join(fiber);
      }),
    { testClock: true },
  );

  expect(result).toBe(false);
  expect(bridgeCalls).toContainEqual({
    path: "world.isActionAvailable",
    args: ["tryQuestComplete"],
  });
  expect(bridgeCalls).not.toContainEqual({
    path: "quests.complete",
    args: [2_330, 1, -1, false],
  });
});

test("complete returns false on rejected ccqr response", async () => {
  const bridge = {
    call(path) {
      if (path === "world.isActionAvailable") {
        return Effect.succeed(true) as never;
      }

      if (path === "quests.complete") {
        return Effect.void as never;
      }

      return Effect.void as never;
    },
    callGameFunction() {
      return Effect.void;
    },
    onConnection() {
      return Effect.succeed(() => {});
    },
  } as BridgeShape;

  const result = await withQuests(bridge, (quests, emitJson) =>
    Effect.gen(function* () {
      const fiber = yield* Effect.forkDetach(quests.complete(2_330, 1), {
        startImmediately: true,
      });
      yield* Effect.yieldNow;
      yield* emitJson("ccqr", {
        QuestID: 2_330,
        bSuccess: 0,
        cmd: "ccqr",
        msg: "Missing items",
      });
      return yield* Fiber.join(fiber);
    }),
  );

  expect(result).toBe(false);
});

test("complete matches failure ccqr without QuestID", async () => {
  const bridge = {
    call(path) {
      if (path === "world.isActionAvailable") {
        return Effect.succeed(true) as never;
      }

      if (path === "quests.complete") {
        return Effect.void as never;
      }

      return Effect.void as never;
    },
    callGameFunction() {
      return Effect.void;
    },
    onConnection() {
      return Effect.succeed(() => {});
    },
  } as BridgeShape;

  const result = await withQuests(bridge, (quests, emitJson) =>
    Effect.gen(function* () {
      const fiber = yield* Effect.forkDetach(quests.complete(2_330, 1), {
        startImmediately: true,
      });
      yield* Effect.yieldNow;
      yield* emitJson("ccqr", {
        bSuccess: 0,
        cmd: "ccqr",
        msg: "Missing items",
      });
      return yield* Fiber.join(fiber);
    }),
  );

  expect(result).toBe(false);
});

test("complete ignores unrelated successful ccqr responses", async () => {
  const bridge = {
    call(path) {
      if (path === "world.isActionAvailable") {
        return Effect.succeed(true) as never;
      }

      if (path === "quests.complete") {
        return Effect.void as never;
      }

      return Effect.void as never;
    },
    callGameFunction() {
      return Effect.void;
    },
    onConnection() {
      return Effect.succeed(() => {});
    },
  } as BridgeShape;

  const result = await withQuests(
    bridge,
    (quests, emitJson) =>
      Effect.gen(function* () {
        const fiber = yield* Effect.forkDetach(quests.complete(2_330, 1), {
          startImmediately: true,
        });
        yield* Effect.yieldNow;
        yield* emitJson("ccqr", {
          QuestID: 999,
          bSuccess: 1,
          cmd: "ccqr",
        });
        yield* Effect.yieldNow;
        yield* TestClock.adjust("6 seconds");
        return yield* Fiber.join(fiber);
      }),
    { testClock: true },
  );

  expect(result).toBe(false);
});
