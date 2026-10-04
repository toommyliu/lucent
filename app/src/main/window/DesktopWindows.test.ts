import { describe, expect, it } from "@effect/vitest";
import { vi } from "vitest";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as Cause from "effect/Cause";
import * as Exit from "effect/Exit";
import * as Scope from "effect/Scope";
vi.mock("electron", () => ({}));
import { makeWindowHarness as makeHarness } from "./DesktopWindows.testing";
import { DesktopWindowError } from "./DesktopWindowError";

for (const tabs of [false, true]) {
  describe(tabs ? "hosted game sessions" : "standalone game sessions", () => {
    it.effect(
      "announces creation before navigation and rejects stale or crashed readiness",
      () =>
        Effect.gen(function* () {
          const h = yield* makeHarness({ tabs });
          const id = yield* h.windows.open("game", {
            onCreated: (event) =>
              Effect.sync(() => {
                expect(
                  h.contents.find((item) => item.id === event.rendererId)!
                    .loads,
                ).toBe(0);
              }),
          });
          const rendererId = yield* h.windows.getRendererId(id);
          const contents = h.contents.find((item) => item.id === rendererId)!;
          yield* h.windows.markRendererReady(rendererId, 1);
          expect(yield* h.windows.isRendererReady(rendererId)).toBe(true);
          contents.reload();
          expect(yield* h.windows.getRendererGeneration(rendererId)).toBe(2);
          expect(yield* h.windows.isRendererReady(rendererId)).toBe(false);
          expect(
            yield* h.windows
              .markRendererReady(rendererId, 1)
              .pipe(Effect.isFailure),
          ).toBe(true);
          contents.emit("render-process-gone", {}, { reason: "crashed" });
          expect(
            yield* h.windows
              .markRendererReady(rendererId, 2)
              .pipe(Effect.isFailure),
          ).toBe(true);
          contents.reload();
          yield* h.windows.markRendererReady(rendererId, 3);
          expect(yield* h.windows.isRendererReady(rendererId)).toBe(true);
          yield* h.windows.closeRenderer(rendererId);
        }),
    );

    it.effect(
      "closes hidden child windows and releases each session once",
      () =>
        Effect.gen(function* () {
          const h = yield* makeHarness({ tabs });
          const closed: number[] = [];
          yield* h.windows.onClosed((event) =>
            Effect.sync(() => {
              closed.push(event.rendererId);
            }),
          );
          const game = yield* h.windows.open("game");
          const rendererId = yield* h.windows.getRendererId(game);
          const tool = yield* h.windows.open("packets", {
            ownerRendererId: rendererId,
          });
          const toolRendererId = yield* h.windows.getRendererId(tool);
          yield* h.windows.closeRenderer(toolRendererId);
          expect(yield* h.windows.getRendererId(tool)).toBe(toolRendererId);
          yield* h.windows.closeRenderer(rendererId);
          yield* h.windows.closeRenderer(rendererId);
          yield* Effect.yieldNow;
          expect(h.nativeWindows.every((window) => window.destroyed)).toBe(
            true,
          );
          expect(h.activePartitions.size).toBe(0);
          expect(h.released).toHaveLength(1);
          expect(closed.filter((id) => id === rendererId)).toHaveLength(1);
          expect(closed.filter((id) => id === toolRendererId)).toHaveLength(1);
        }),
    );
  });
}

describe("desktop window ownership", () => {
  it.effect("rolls back a failed new tab without closing its sibling", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness();
      const first = yield* h.windows.open("game");
      const rendererId = yield* h.windows.getRendererId(first);
      const hostId = yield* h.windows.getGameViewHostRendererId(rendererId);
      const failed = yield* h.windows
        .open("game", {
          gameHostTarget: { kind: "game-view", rendererId },
          onCreated: () => Effect.fail("cancel launch"),
        })
        .pipe(Effect.isFailure);
      expect(failed).toBe(true);
      expect(
        (yield* h.windows.getGameViewHostState(hostId)).sessions.map(
          (session) => session.id,
        ),
      ).toEqual([first]);
      expect(h.nativeWindows[0]!.destroyed).toBe(false);
      expect(h.activePartitions.size).toBe(1);
      expect(h.released).toHaveLength(1);
      yield* h.windows.closeRenderer(rendererId);
    }),
  );

  it.effect("publishes one close per tab when the native host closes", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness();
      const closed: string[] = [];
      yield* h.windows.onClosed((event) =>
        Effect.sync(() => {
          closed.push(event.id);
        }),
      );
      const first = yield* h.windows.open("game");
      const rendererId = yield* h.windows.getRendererId(first);
      const second = yield* h.windows.open("game", {
        gameHostTarget: { kind: "game-view", rendererId },
      });
      h.nativeWindows[0]!.destroy();
      yield* Effect.yieldNow;
      expect(closed.toSorted()).toEqual([first, second].toSorted());
      expect(h.activePartitions.size).toBe(0);
      expect(h.released).toHaveLength(2);
    }),
  );

  it.effect("reuses a hidden application window", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness();
      const id = yield* h.windows.open("settings");
      yield* h.windows.closeRenderer(yield* h.windows.getRendererId(id));
      expect(h.nativeWindows[0]!.visible).toBe(false);
      expect(yield* h.windows.open("settings")).toBe(id);
      expect(h.nativeWindows).toHaveLength(1);
      expect(h.nativeWindows[0]!.visible).toBe(true);
      h.nativeWindows[0]!.destroy();
    }),
  );
});

describe("scoped window resources", () => {
  for (const fault of ["viewBackground", "attach"] as const) {
    it.effect(`releases a partially created tab after ${fault} fails`, () =>
      Effect.gen(function* () {
        const h = yield* makeHarness();
        const first = yield* h.windows.open("game");
        const rendererId = yield* h.windows.getRendererId(first);
        h.faults[fault] = true;
        const failed = yield* h.windows
          .open("game", { gameHostTarget: { kind: "game-view", rendererId } })
          .pipe(Effect.isFailure);
        h.faults[fault] = false;
        expect(failed).toBe(true);
        expect(h.activePartitions.size).toBe(1);
        expect(h.released).toHaveLength(1);
        expect(h.contents.at(-1)!.destroyed).toBe(true);
        expect(h.nativeWindows[0]!.destroyed).toBe(false);
        const hostId = yield* h.windows.getGameViewHostRendererId(rendererId);
        expect(
          (yield* h.windows.getGameViewHostState(hostId)).sessions.map(
            (view) => view.id,
          ),
        ).toEqual([first]);
      }),
    );
  }

  it.effect(
    "runs the remaining finalizers when a native view cannot close",
    () =>
      Effect.gen(function* () {
        const h = yield* makeHarness();
        const first = yield* h.windows.open("game");
        const rendererId = yield* h.windows.getRendererId(first);
        yield* h.windows.open("game", {
          gameHostTarget: { kind: "game-view", rendererId },
        });
        const closed: string[] = [];
        yield* h.windows.onClosed((event) =>
          Effect.sync(() => {
            closed.push(event.id);
          }),
        );
        h.faults.viewClose = true;
        expect(
          yield* h.windows.closeRenderer(rendererId).pipe(Effect.isFailure),
        ).toBe(true);
        h.faults.viewClose = false;
        expect(h.activePartitions.size).toBe(1);
        expect(h.released).toHaveLength(1);
        expect(closed).toEqual([first]);
        expect(yield* h.windows.closeRenderer(rendererId)).toBe(false);
        h.contents.find((contents) => contents.id === rendererId)!.close();
      }),
  );

  it.effect(
    "closes all windows and removes observers when the service scope closes",
    () =>
      Effect.gen(function* () {
        const scope = yield* Scope.fork(yield* Effect.scope);
        const h = yield* makeHarness().pipe(Scope.provide(scope));
        const first = yield* h.windows.open("game");
        const rendererId = yield* h.windows.getRendererId(first);
        yield* h.windows.open("game", {
          gameHostTarget: { kind: "game-view", rendererId },
        });
        yield* h.windows.open("packets", { ownerRendererId: rendererId });
        yield* h.windows.open("settings");
        yield* Scope.close(scope, Exit.void);
        yield* Scope.close(scope, Exit.void);
        expect(h.nativeWindows.every((window) => window.destroyed)).toBe(true);
        expect(
          h.contents.every(
            (contents) =>
              contents.destroyed && contents.eventNames().length === 0,
          ),
        ).toBe(true);
        expect(h.activePartitions.size).toBe(0);
        expect(h.released).toHaveLength(2);
        expect(h.appEvents.eventNames()).toEqual([]);
      }),
  );

  it.effect(
    "publishes closure after destroying the view and releasing its partition",
    () =>
      Effect.gen(function* () {
        const h = yield* makeHarness();
        const id = yield* h.windows.open("game");
        const rendererId = yield* h.windows.getRendererId(id);
        const states: unknown[] = [];
        yield* h.windows.onClosed((event) =>
          Effect.sync(() => {
            if (event.id === id)
              states.push({
                destroyed: h.contents.find(
                  (contents) => contents.id === rendererId,
                )!.destroyed,
                leases: h.activePartitions.size,
              });
          }),
        );
        yield* h.windows.closeRenderer(rendererId);
        expect(states).toEqual([{ destroyed: true, leases: 0 }]);
      }),
  );

  it.effect("quits once after hiding the last top-level window on Linux", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness({ platform: "linux" });
      const id = yield* h.windows.open("settings");
      yield* h.windows.closeRenderer(yield* h.windows.getRendererId(id));
      yield* Effect.yieldNow;
      expect(h.quitCount()).toBe(1);
      expect(h.nativeWindows[0]!.destroyed).toBe(false);
    }),
  );

  it.effect(
    "restores a game on macOS activation after the last window closes",
    () =>
      Effect.gen(function* () {
        const h = yield* makeHarness();
        const id = yield* h.windows.open("game");
        yield* h.windows.closeRenderer(yield* h.windows.getRendererId(id));
        h.appEvents.emit("activate");
        yield* Effect.yieldNow;
        expect(
          h.nativeWindows.filter((window) => !window.destroyed),
        ).toHaveLength(1);
        expect(h.quitCount()).toBe(0);
      }),
  );
});

it.effect(
  "keeps game sessions alive when the tab-strip contents are destroyed",
  () =>
    Effect.gen(function* () {
      const h = yield* makeHarness();
      const first = yield* h.windows.open("game");
      const rendererId = yield* h.windows.getRendererId(first);
      const second = yield* h.windows.open("game", {
        gameHostTarget: { kind: "game-view", rendererId },
      });
      const secondRendererId = yield* h.windows.getRendererId(second);
      const hostId = yield* h.windows.getGameViewHostRendererId(rendererId);
      h.contents.find((contents) => contents.id === hostId)!.close();
      yield* Effect.yieldNow;
      expect(h.activePartitions.size).toBe(2);
      expect(h.nativeWindows[0]!.destroyed).toBe(false);
      yield* h.windows.closeRenderer(rendererId);
      expect(h.activePartitions.size).toBe(1);
      expect(yield* h.windows.getRendererId(second)).toBe(secondRendererId);
      expect(h.nativeWindows[0]!.destroyed).toBe(false);
    }),
);

for (const tabs of [false, true]) {
  it.effect(
    `cancels an unfinished ${tabs ? "hosted" : "standalone"} launch when its window closes`,
    () =>
      Effect.gen(function* () {
        const h = yield* makeHarness({ tabs });
        const started = yield* Deferred.make<void>();
        const opening = yield* h.windows
          .open("game", {
            onCreated: () =>
              Deferred.succeed(started, undefined).pipe(
                Effect.andThen(Effect.never),
              ),
          })
          .pipe(Effect.forkScoped);
        yield* Deferred.await(started);
        h.nativeWindows[0]!.destroy();
        const exit = yield* Fiber.await(opening);
        expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toBeInstanceOf(
          DesktopWindowError,
        );
        expect(h.activePartitions.size).toBe(0);
        expect(h.released).toHaveLength(1);
        expect(h.contents.every((contents) => contents.destroyed)).toBe(true);
      }),
  );
}

it.effect(
  "rolls back an interrupted launch without closing existing tabs",
  () =>
    Effect.gen(function* () {
      const h = yield* makeHarness();
      const first = yield* h.windows.open("game");
      const rendererId = yield* h.windows.getRendererId(first);
      const started = yield* Deferred.make<void>();
      const opening = yield* h.windows
        .open("game", {
          gameHostTarget: { kind: "game-view", rendererId },
          onCreated: () =>
            Deferred.succeed(started, undefined).pipe(
              Effect.andThen(Effect.never),
            ),
        })
        .pipe(Effect.forkScoped);
      yield* Deferred.await(started);
      yield* Fiber.interrupt(opening);
      const exit = yield* Fiber.await(opening);
      expect(Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)).toBe(
        true,
      );
      expect(h.activePartitions.size).toBe(1);
      expect(h.nativeWindows[0]!.destroyed).toBe(false);
      expect(yield* h.windows.getRendererId(first)).toBe(rendererId);
    }),
);

for (const tabs of [false, true]) {
  it.effect(
    `interrupts pending ${tabs ? "hosted" : "standalone"} navigation when its window closes`,
    () =>
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>();
        const stopped = yield* Deferred.make<void>();
        const h = yield* makeHarness({
          tabs,
          gameLoad: Deferred.succeed(started, undefined).pipe(
            Effect.andThen(Effect.never),
            Effect.ensuring(Deferred.succeed(stopped, undefined)),
          ),
        });
        const opening = yield* h.windows.open("game").pipe(Effect.forkScoped);
        yield* Deferred.await(started);
        h.nativeWindows[0]!.destroy();
        yield* Deferred.await(stopped);
        yield* Fiber.await(opening);
        expect(h.activePartitions.size).toBe(0);
        expect(h.released).toHaveLength(1);
        expect(h.contents.every((contents) => contents.destroyed)).toBe(true);
      }),
  );
}

it.effect("rolls back a new tab when revealing its existing host fails", () =>
  Effect.gen(function* () {
    const h = yield* makeHarness();
    const first = yield* h.windows.open("game");
    const rendererId = yield* h.windows.getRendererId(first);
    h.faults.reveal = true;
    const failed = yield* h.windows
      .open("game", { gameHostTarget: { kind: "game-view", rendererId } })
      .pipe(Effect.isFailure);
    h.faults.reveal = false;
    expect(failed).toBe(true);
    expect(h.activePartitions.size).toBe(1);
    expect(h.nativeWindows[0]!.destroyed).toBe(false);
    expect(yield* h.windows.getRendererId(first)).toBe(rendererId);
    const hostId = yield* h.windows.getGameViewHostRendererId(rendererId);
    expect(
      (yield* h.windows.getGameViewHostState(hostId)).sessions.map(
        (view) => view.id,
      ),
    ).toEqual([first]);
  }),
);

it.effect(
  "updates sibling view backgrounds when one native view rejects the change",
  () =>
    Effect.gen(function* () {
      const h = yield* makeHarness();
      const first = yield* h.windows.open("game");
      const rendererId = yield* h.windows.getRendererId(first);
      const second = yield* h.windows.open("game", {
        gameHostTarget: { kind: "game-view", rendererId },
      });
      const secondRendererId = yield* h.windows.getRendererId(second);
      h.faults.viewBackgroundIds.add(rendererId);
      yield* h.windows.setBackgroundColor("#123456");
      expect(h.viewColors.get(secondRendererId)).toBe("#123456");
    }),
);

it.effect(
  "finishes owned resource teardown when the close caller is interrupted",
  () =>
    Effect.gen(function* () {
      const h = yield* makeHarness();
      const id = yield* h.windows.open("game");
      const rendererId = yield* h.windows.getRendererId(id);
      yield* h.windows.open("packets", { ownerRendererId: rendererId });
      const notified = yield* Deferred.make<void>();
      yield* h.windows.onClosed((event) =>
        event.kind === "packets"
          ? Deferred.succeed(notified, undefined).pipe(
              Effect.andThen(Effect.never),
            )
          : Effect.void,
      );
      const closing = yield* h.windows
        .closeRenderer(rendererId)
        .pipe(Effect.forkScoped);
      yield* Deferred.await(notified);
      yield* Fiber.interrupt(closing);
      yield* Effect.yieldNow;
      expect(h.contents.every((contents) => contents.destroyed)).toBe(true);
      expect(h.activePartitions.size).toBe(0);
      expect(h.released).toHaveLength(1);
      expect(yield* h.windows.closeRenderer(rendererId)).toBe(false);
    }),
);

it.effect(
  "releases the partition after interruption during asynchronous native cleanup",
  () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const h = yield* makeHarness({
        beforeViewClose: Deferred.succeed(started, undefined).pipe(
          Effect.andThen(Deferred.await(release)),
        ),
      });
      const first = yield* h.windows.open("game");
      const rendererId = yield* h.windows.getRendererId(first);
      yield* h.windows.open("game", {
        gameHostTarget: { kind: "game-view", rendererId },
      });
      const closing = yield* h.windows
        .closeRenderer(rendererId)
        .pipe(Effect.forkScoped);
      yield* Deferred.await(started);
      const interrupting = yield* Fiber.interrupt(closing).pipe(
        Effect.forkScoped,
      );
      yield* Effect.yieldNow;
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(interrupting);
      expect(
        h.contents.find((contents) => contents.id === rendererId)!.destroyed,
      ).toBe(true);
      expect(h.activePartitions.size).toBe(1);
      expect(h.released).toHaveLength(1);
    }),
);

for (const disposeService of [false, true]) {
  it.effect(
    `destroys every tab without waiting for a close subscriber${disposeService ? " during service disposal" : ""}`,
    () =>
      Effect.gen(function* () {
        const scope = yield* Scope.fork(yield* Effect.scope);
        const h = yield* makeHarness().pipe(Scope.provide(scope));
        const first = yield* h.windows.open("game");
        const rendererId = yield* h.windows.getRendererId(first);
        const second = yield* h.windows.open("game", {
          gameHostTarget: { kind: "game-view", rendererId },
        });
        const notified = yield* Deferred.make<void>();
        const closed: string[] = [];
        yield* h.windows.onClosed((event) =>
          Effect.gen(function* () {
            closed.push(event.id);
            if (event.id === second) {
              yield* Deferred.succeed(notified, undefined);
              return yield* Effect.never;
            }
          }),
        );
        h.nativeWindows[0]!.destroy();
        yield* Deferred.await(notified);
        if (disposeService) yield* Scope.close(scope, Exit.void);
        yield* Effect.yieldNow;
        expect(h.contents.every((contents) => contents.destroyed)).toBe(true);
        expect(h.activePartitions.size).toBe(0);
        expect(h.released).toHaveLength(2);
        expect(closed.toSorted()).toEqual([first, second].toSorted());
      }),
  );
}

it.effect(
  "can dispose the service while a renderer-destroyed subscriber is waiting",
  () =>
    Effect.gen(function* () {
      const scope = yield* Scope.fork(yield* Effect.scope);
      const h = yield* makeHarness().pipe(Scope.provide(scope));
      const id = yield* h.windows.open("game");
      const notified = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const disposed = yield* Deferred.make<void>();
      yield* h.windows.onRendererDestroyed(() =>
        Deferred.succeed(notified, undefined).pipe(
          Effect.andThen(Deferred.await(release)),
        ),
      );
      yield* h.windows.closeRenderer(yield* h.windows.getRendererId(id));
      yield* Deferred.await(notified);
      const closing = yield* Scope.close(scope, Exit.void).pipe(
        Effect.andThen(Deferred.succeed(disposed, undefined)),
        Effect.forkScoped,
      );
      yield* Effect.yieldNow;
      const completedBeforeSubscriber = yield* Deferred.isDone(disposed);
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(closing);
      expect(completedBeforeSubscriber).toBe(true);
      expect(h.contents.every((contents) => contents.destroyed)).toBe(true);
      expect(h.activePartitions.size).toBe(0);
    }),
);

for (const via of ["tab", "renderer", "host"] as const) {
  it.effect(
    `notifies renderer destruction exactly once when ${via} closure precedes Electron's event`,
    () =>
      Effect.gen(function* () {
        const h = yield* makeHarness({ deferDestruction: true });
        const first = yield* h.windows.open("game");
        const rendererId = yield* h.windows.getRendererId(first);
        const second = yield* h.windows.open("game", {
          gameHostTarget: { kind: "game-view", rendererId },
        });
        const secondRendererId = yield* h.windows.getRendererId(second);
        const destroyed: number[] = [];
        yield* h.windows.onRendererDestroyed((event) =>
          Effect.sync(() => {
            destroyed.push(event.rendererId);
          }),
        );
        if (via === "tab")
          yield* h.windows.closeGameView(
            yield* h.windows.getGameViewHostRendererId(rendererId),
            second,
          );
        else if (via === "renderer")
          yield* h.windows.closeRenderer(secondRendererId);
        else h.nativeWindows[0]!.destroy();
        h.flushDestructions();
        yield* Effect.yieldNow;
        expect(destroyed.toSorted()).toEqual(
          via === "host"
            ? [rendererId, secondRendererId].toSorted()
            : [secondRendererId],
        );
      }),
  );
}

for (const tabs of [false, true]) {
  it.effect(
    `keeps ${tabs ? "hosted" : "standalone"} readiness until the main document navigates`,
    () =>
      Effect.gen(function* () {
        const h = yield* makeHarness({ tabs });
        const id = yield* h.windows.open("game");
        const rendererId = yield* h.windows.getRendererId(id);
        const generation = yield* h.windows.getRendererGeneration(rendererId);
        yield* h.windows.markRendererReady(rendererId, generation);
        const contents = h.contents.find(
          (contents) => contents.id === rendererId,
        )!;
        contents.emit("did-start-loading");
        expect(yield* h.windows.isRendererReady(rendererId)).toBe(true);
        contents.reload();
        expect(yield* h.windows.isRendererReady(rendererId)).toBe(false);
        expect(yield* h.windows.getRendererGeneration(rendererId)).toBe(
          generation + 1,
        );
      }),
  );
}
