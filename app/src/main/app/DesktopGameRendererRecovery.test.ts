import { EventEmitter } from "node:events";
import { describe, expect, it } from "@effect/vitest";
import { vi } from "vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Scope from "effect/Scope";
vi.mock("electron", () => ({}));
import {
  makeDesktopGameRendererRecovery,
  type RecoverableGameWebContents,
} from "./DesktopGameRendererRecovery";

const makeRecovery = Effect.fn(function* () {
  const started = yield* Deferred.make<void>();
  const answer = yield* Deferred.make<number>();
  const interrupted = yield* Deferred.make<void>();
  const events = new EventEmitter();
  let destroyed = false;
  let reloads = 0;
  let crashes = 0;
  let prompts = 0;
  let suppressed = 0;
  const errors: string[] = [];
  const target = Object.assign(events, {
    id: 42,
    isDestroyed: () => destroyed,
    getOSProcessId: () => 99,
    forcefullyCrashRenderer: () => {
      crashes++;
      events.emit("render-process-gone", {}, { reason: "killed" });
    },
    reload: () => {
      reloads++;
      events.emit("did-start-loading");
    },
  }) as unknown as RecoverableGameWebContents;
  const prompt = Effect.gen(function* () {
    prompts++;
    yield* Deferred.succeed(started, undefined);
    return yield* Deferred.await(answer);
  }).pipe(Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined)));
  const appEvents = new EventEmitter();
  const service = makeDesktopGameRendererRecovery({
    allWebContents: () => [target],
    getNativeWindowId: () => Effect.succeed(1),
    getRendererKind: () => Effect.succeed("game"),
    onWebContentsCreated: (listener) => {
      appEvents.on("created", listener);
      return () => {
        appEvents.off("created", listener);
      };
    },
    onBeforeQuit: (listener) => {
      appEvents.on("quit", listener);
      return () => {
        appEvents.off("quit", listener);
      };
    },
    showRecoveryPrompt: () => prompt,
    showRendererRecoveryPrompt: () => prompt,
    suppressLaunchScript: () =>
      Effect.sync(() => {
        suppressed++;
      }),
    warn: () => Effect.void,
    info: () => Effect.void,
    error: (message) =>
      Effect.sync(() => {
        errors.push(message);
      }),
  });
  const scope = yield* Scope.fork(yield* Effect.scope);
  yield* service.install.pipe(Scope.provide(scope));
  return {
    service,
    scope,
    target,
    events,
    appEvents,
    started,
    answer,
    interrupted,
    errors,
    state: () => ({ reloads, crashes, prompts, suppressed }),
    destroy: () => {
      destroyed = true;
      events.emit("destroyed");
    },
  };
});

describe("renderer recovery lifetime", () => {
  for (const initial of ["crash", "unresponsive"] as const) {
    it.effect(
      `keeps one prompt open across navigation during ${initial} recovery`,
      () =>
        Effect.gen(function* () {
          const h = yield* makeRecovery();
          yield* h.service.beginScriptExecution(42);
          if (initial === "crash")
            h.events.emit("render-process-gone", {}, { reason: "crashed" });
          else h.events.emit("unresponsive");
          yield* Deferred.await(h.started);
          h.events.emit("did-start-loading");
          h.events.emit("render-process-gone", {}, { reason: "crashed" });
          yield* Effect.yieldNow;
          expect(h.state().prompts).toBe(1);
        }),
    );
  }
  for (const closing of ["renderer", "installer"] as const) {
    it.effect(`cancels a pending recovery when the ${closing} closes`, () =>
      Effect.gen(function* () {
        const h = yield* makeRecovery();
        yield* h.service.beginScriptExecution(42);
        h.events.emit("unresponsive");
        yield* Deferred.await(h.started);
        if (closing === "renderer") h.destroy();
        else yield* Scope.close(h.scope, Exit.void);
        yield* Deferred.await(h.interrupted);
        yield* Deferred.succeed(h.answer, 0);
        yield* Effect.yieldNow;
        expect(h.state()).toEqual({
          reloads: 0,
          crashes: 0,
          prompts: 1,
          suppressed: 0,
        });
        expect(h.events.eventNames()).toEqual([]);
        expect(h.errors).toEqual([]);
        if (closing === "installer")
          expect(h.appEvents.eventNames()).toEqual([]);
      }),
    );
  }
  it.effect(
    "keeps recovery installed across reloads and suppresses a second prompt for intentional crashes",
    () =>
      Effect.gen(function* () {
        const h = yield* makeRecovery();
        h.events.emit("did-start-loading");
        yield* h.service.beginScriptExecution(42);
        h.events.emit("unresponsive");
        yield* Deferred.await(h.started);
        yield* Deferred.succeed(h.answer, 0);
        yield* Effect.yieldNow;
        expect(h.state()).toEqual({
          reloads: 1,
          crashes: 1,
          prompts: 1,
          suppressed: 1,
        });
        expect(h.events.listenerCount("unresponsive")).toBe(1);
        expect(h.errors).toEqual([]);
      }),
  );
  it.effect(
    "does not reload a newer document after an old crash prompt resolves",
    () =>
      Effect.gen(function* () {
        const h = yield* makeRecovery();
        h.events.emit("render-process-gone", {}, { reason: "crashed" });
        yield* Deferred.await(h.started);
        h.events.emit("did-start-loading");
        yield* Deferred.succeed(h.answer, 0);
        yield* Effect.yieldNow;
        expect(h.state()).toEqual({
          reloads: 0,
          crashes: 0,
          prompts: 1,
          suppressed: 0,
        });
      }),
  );
});
