import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";

import type { ScriptRuntimeOptions } from "./ScriptApi";
import {
  makeScriptRuntimeApi,
  snapshotScriptRuntimeOptions,
} from "./ScriptRuntime";
import { ScriptStopSignal } from "./ScriptRunnerErrors";
import { makeScriptAsyncScope } from "./scriptAsyncScope";

describe("ScriptRuntime", () => {
  it.effect("owns its inputs, options, and cancellation signal", () =>
    Effect.gen(function* () {
      const scope = makeScriptAsyncScope();
      let options: ScriptRuntimeOptions = {
        restartAfterReconnect: false,
        safeStartStop: true,
        usePrivateRooms: true,
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
      yield* script.options.setUsePrivateRooms(false);
      expect(options.restartAfterReconnect).toBe(true);
      expect(options.usePrivateRooms).toBe(false);
      expect(script.signal.aborted).toBe(false);

      const stop = yield* script.stop("done").pipe(Effect.flip);
      expect(stop).toBeInstanceOf(ScriptStopSignal);
      expect(stop.reason).toBe("done");

      yield* scope.close;
      expect(script.signal.aborted).toBe(true);
    }),
  );
});
