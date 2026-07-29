import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import type { ScriptRuntimeOptions } from "./ScriptApi";
import {
  makeScriptRuntimeApi,
  snapshotScriptRuntimeOptions,
} from "./ScriptRuntime";
import { ScriptExecutionError, ScriptStopSignal } from "./ScriptRunnerErrors";
import { makeScriptAsyncScope } from "./scriptAsyncScope";

describe("ScriptRuntime", () => {
  it.effect("owns its inputs, options, and cancellation signal", () =>
    Effect.gen(function* () {
      const scope = makeScriptAsyncScope();
      let options: ScriptRuntimeOptions = {
        restartAfterReconnect: false,
        roomPolicy: { kind: "random-private" },
        safeStartStop: true,
      };
      const script = makeScriptRuntimeApi({
        getOptions: () => Effect.succeed(snapshotScriptRuntimeOptions(options)),
        inputValues: { item: "Weapon" },
        log: () => undefined,
        scope,
        setOptions: (update) =>
          Effect.sync(() => {
            options = snapshotScriptRuntimeOptions(update(options));
            return snapshotScriptRuntimeOptions(options);
          }),
      });

      expect(yield* script.inputs.get("item")).toBe("Weapon");
      yield* script.options.setRestartAfterReconnect(true);
      yield* script.options.setRoomPolicy({
        kind: "specific",
        roomNumber: 42,
      });
      expect(options.restartAfterReconnect).toBe(true);
      expect(yield* script.options.getRoomPolicy()).toEqual({
        kind: "specific",
        roomNumber: 42,
      });
      expect(options.roomPolicy).toEqual({
        kind: "specific",
        roomNumber: 42,
      });

      const invalidPolicy = yield* script.options
        .setRoomPolicy({
          kind: "specific",
          roomNumber: 0,
        })
        .pipe(Effect.flip);
      expect(invalidPolicy).toBeInstanceOf(ScriptExecutionError);
      expect(options.roomPolicy).toEqual({
        kind: "specific",
        roomNumber: 42,
      });

      expect(yield* script.options.reset()).toEqual({
        restartAfterReconnect: false,
        roomPolicy: { kind: "random-private" },
        safeStartStop: true,
      });
      expect(script.signal.aborted).toBe(false);

      const stop = yield* script.stop("done").pipe(Effect.flip);
      expect(stop).toBeInstanceOf(ScriptStopSignal);
      expect(stop.reason).toBe("done");

      yield* scope.close;
      expect(script.signal.aborted).toBe(true);
    }),
  );
});
