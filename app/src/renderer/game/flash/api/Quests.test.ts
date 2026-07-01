import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";

import { bridgeFallbacks } from "../../BridgeFallbacks";
import { SwfBridge, type SwfBridgeShape } from "../SwfBridge";
import type { FlashProtocolShape } from "../protocol/FlashProtocol";
import { FlashProtocol } from "../protocol/FlashProtocol";
import { QuestsState } from "../state/Quests";
import * as QuestsStore from "../state/Quests";
import { QuestsApi, layer as QuestsApiLayer } from "./Quests";
import type { WaitApiShape } from "./Wait";
import { WaitApi } from "./Wait";

const makeLayer = (
  calls: Array<{ readonly args: readonly unknown[]; readonly method: string }>,
  onLoad: () => Effect.Effect<void>,
) => {
  const bridge = SwfBridge.of({
    call: ((method, args) =>
      Effect.gen(function* () {
        calls.push({ args: args ?? [], method });
        switch (method) {
          case "quests.getMaxTurnIns":
            return 2;
          case "quests.load":
            yield* onLoad();
            return undefined;
          default:
            return bridgeFallbacks[method]();
        }
      })) as SwfBridgeShape["call"],
    callGameFunction: () => Effect.succeed(null),
    readJson: () => Effect.succeed(null),
  });
  const protocol = FlashProtocol.of({
    emitEvent: () => Effect.void,
    onEvent: () => Effect.succeed(() => {}),
    onPacket: () => Effect.succeed(() => {}),
    onceEvent: () => Effect.succeed(null),
    oncePacket: (selector) =>
      Effect.succeed({
        command: selector?.command ?? "ccqr",
        data: { QuestID: 55, bSuccess: true, cmd: selector?.command },
        direction: "server",
        raw: "{}",
        wireType: "json",
      }),
    sendClient: () => Effect.void,
    sendServer: () => Effect.void,
  } satisfies FlashProtocolShape);
  const wait = WaitApi.of({
    forEvent: () => Effect.succeed(null),
    forGameAction: () => Effect.succeed(true),
    forPacket: () => Effect.succeed(null),
    isGameActionAvailable: () => Effect.succeed(true),
    until: (condition) => condition,
    untilSome: (condition) =>
      condition.pipe(
        Effect.map((result) => (Option.isSome(result) ? result.value : null)),
      ),
  } satisfies WaitApiShape);

  return QuestsApiLayer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        QuestsStore.layer,
        Layer.succeed(SwfBridge, bridge),
        Layer.succeed(FlashProtocol, protocol),
        Layer.succeed(WaitApi, wait),
      ),
    ),
  );
};

describe("QuestsApi", () => {
  it.effect("loads quests through bridge and waits for quest cache", () =>
    Effect.gen(function* () {
      const calls: Array<{
        readonly args: readonly unknown[];
        readonly method: string;
      }> = [];
      let onLoad: Effect.Effect<void> = Effect.void;
      const layer = makeLayer(calls, () => onLoad);
      yield* Effect.gen(function* () {
        const api = yield* QuestsApi;
        const quests = yield* QuestsState;
        onLoad = quests.reduceGetQuests({
          quests: {
            55: { sName: "Loaded Quest" },
          },
        });

        expect(yield* api.load(55)).toBe(true);
        expect((yield* api.get(55))?.name).toBe("Loaded Quest");
      }).pipe(Effect.provide(layer));

      expect(calls.map((call) => call.method)).toEqual(["quests.load"]);
    }),
  );

  it.effect("settles complete on matching ccqr packet", () =>
    Effect.gen(function* () {
      const calls: Array<{
        readonly args: readonly unknown[];
        readonly method: string;
      }> = [];
      const layer = makeLayer(calls, () => Effect.void);
      const api = yield* QuestsApi.pipe(Effect.provide(layer));

      expect(yield* api.complete(55)).toBe(true);
      expect(calls.map((call) => call.method)).toEqual([
        "quests.getMaxTurnIns",
        "quests.complete",
      ]);
      expect(calls[1]?.args).toEqual([55, 2, -1, false]);
    }),
  );
});
