import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import type { ScriptRuntimeOptions } from "./ScriptApi";
import {
  makeScriptRuntimeApi,
  snapshotScriptRuntimeOptions,
} from "./ScriptRuntime";
import { ScriptExecutionError, ScriptStopSignal } from "./ScriptRunnerErrors";
import { makeScriptAsyncScope } from "./scriptAsyncScope";

const makeRuntime = () => {
  const scope = makeScriptAsyncScope();
  let options: ScriptRuntimeOptions = {
    restartAfterReconnect: false,
    roomPolicy: { kind: "random-private" },
    safeStartStop: true,
  };
  const rewards = ["Weapon"];
  const dialogCalls: string[] = [];
  const script = makeScriptRuntimeApi({
    dialogs: {
      alert: (_source, message) =>
        Effect.sync(() => {
          dialogCalls.push(`alert:${message}`);
        }),
      confirm: (_source, message) =>
        Effect.sync(() => {
          dialogCalls.push(`confirm:${message}`);
          return false;
        }),
      prompt: (_source, message, placeholder) =>
        Effect.sync(() => {
          dialogCalls.push(`prompt:${message}:${placeholder ?? ""}`);
          return "Gravelyn";
        }),
    },
    getOptions: () => Effect.succeed(snapshotScriptRuntimeOptions(options)),
    inputValues: { item: "Weapon", rewards },
    log: () => undefined,
    scope,
    setOptions: (update) =>
      Effect.sync(() => {
        options = snapshotScriptRuntimeOptions(update(options));
        return snapshotScriptRuntimeOptions(options);
      }),
    source: { sourceName: "Runtime test" },
  });

  return { script, scope, rewards, dialogCalls, getOptions: () => options };
};

describe("ScriptRuntime", () => {
  it.effect("forwards dialogs and their responses", () =>
    Effect.gen(function* () {
      const { script, scope, dialogCalls } = makeRuntime();
      yield* Effect.addFinalizer(() => scope.close);
      yield* script.alert("Finished");
      expect(yield* script.confirm("Continue?")).toBe(false);
      expect(yield* script.prompt("Target", "Artix")).toBe("Gravelyn");
      expect(dialogCalls).toEqual([
        "alert:Finished",
        "confirm:Continue?",
        "prompt:Target:Artix",
      ]);
    }),
  );

  it.effect("owns input arrays on ingress and on each read", () =>
    Effect.gen(function* () {
      const { script, scope, rewards } = makeRuntime();
      yield* Effect.addFinalizer(() => scope.close);
      expect(yield* script.inputs.get("item")).toBe("Weapon");
      rewards.push("Armor");
      const selectedRewards = yield* script.inputs.get("rewards");
      expect(selectedRewards).toEqual(["Weapon"]);
      if (Array.isArray(selectedRewards)) selectedRewards.push("Pet");
      expect(yield* script.inputs.get("rewards")).toEqual(["Weapon"]);

      const allInputs = yield* script.inputs.getAll();
      if (Array.isArray(allInputs["rewards"])) {
        allInputs["rewards"].push("Armor");
      }
      expect(yield* script.inputs.get("rewards")).toEqual(["Weapon"]);
    }),
  );

  it.effect(
    "validates option changes before committing and restores initial options",
    () =>
      Effect.gen(function* () {
        const { script, scope, getOptions } = makeRuntime();
        yield* Effect.addFinalizer(() => scope.close);
        yield* script.options.update({
          restartAfterReconnect: true,
          roomPolicy: { kind: "specific", roomNumber: 42 },
        });
        expect(getOptions().restartAfterReconnect).toBe(true);
        expect((yield* script.options.get()).roomPolicy).toEqual({
          kind: "specific",
          roomNumber: 42,
        });
        expect(getOptions().roomPolicy).toEqual({
          kind: "specific",
          roomNumber: 42,
        });

        const invalidPolicy = yield* script.options
          .update({
            roomPolicy: { kind: "specific", roomNumber: 0 },
          })
          .pipe(Effect.flip);
        expect(invalidPolicy).toBeInstanceOf(ScriptExecutionError);
        expect(getOptions().roomPolicy).toEqual({
          kind: "specific",
          roomNumber: 42,
        });

        yield* script.options.reset();
        expect(yield* script.options.get()).toEqual({
          restartAfterReconnect: false,
          roomPolicy: { kind: "random-private" },
          safeStartStop: true,
        });
      }),
  );

  it.effect(
    "preserves the stop reason and aborts its signal on scope closure",
    () =>
      Effect.gen(function* () {
        const { script, scope } = makeRuntime();
        yield* Effect.addFinalizer(() => scope.close);
        expect(script.signal.aborted).toBe(false);

        const stop = yield* script.stop("done").pipe(Effect.flip);
        expect(stop).toBeInstanceOf(ScriptStopSignal);
        expect(stop.reason).toBe("done");

        yield* scope.close;
        expect(script.signal.aborted).toBe(true);
      }),
  );
});
