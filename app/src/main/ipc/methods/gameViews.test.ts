import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { GameViewHostState } from "../../../shared/gameViews";
import { ElectronDialog } from "../../electron/ElectronDialog";
import { Accounts } from "../../internal/accounts/Accounts";
import {
  AccountSessions,
  layer as sessionsLayer,
} from "../../internal/accounts/AccountSessions";
import { DesktopWindows } from "../../window/DesktopWindows";
import { close, closeCurrent, reopen } from "./gameViews";

const hostState: GameViewHostState = {
  capacity: 7,
  groupControlsOpen: false,
  groupTargetIds: [],
  layout: "focused",
  selectedId: "tab-1",
  sessions: [{ id: "tab-1", name: "Alice", phase: "ready" }],
};
const sender = { kind: "game-host", rendererId: 100 } as const;

describe("game view lifecycle IPC", () => {
  it.effect("keeps running scripts open until close is confirmed", () =>
    Effect.gen(function* () {
      const sessions = yield* AccountSessions;
      sessions.openWindow(77, 1, 1);
      sessions.openWindow(42, 1, 1);
      sessions.applyReport(42, {
        rendererGeneration: 1,
        revision: 1,
        runtime: {
          connection: { state: "online", username: "Alice" },
          login: { state: "idle" },
          script: { state: "running", name: "farm.js" },
        },
      });
      let response = 0;
      const closed: string[] = [];
      const parents: (number | undefined)[] = [];
      const dependencies = Layer.mergeAll(
        Layer.mock(ElectronDialog, {
          showMessageBox: (_options, parentId) =>
            Effect.sync(() => {
              parents.push(parentId);
              return { response, checkboxChecked: false };
            }),
        }),
        Layer.mock(DesktopWindows, {
          getGameViewHostState: () => Effect.succeed(hostState),
          getRendererId: () => Effect.succeed(42),
          getNativeWindowId: () => Effect.succeed(1),
          closeGameView: (_hostId, id) =>
            Effect.sync(() => {
              closed.push(id);
              sessions.closeWindow(42, 50);
            }),
        }),
      );
      yield* close
        .handler({ id: "tab-1" }, sender)
        .pipe(Effect.provide(dependencies));
      expect(
        sessions
          .snapshot()
          .map((session) => session.gameWindowId)
          .toSorted((a, b) => a - b),
      ).toEqual([42, 77]);
      expect(sessions.recentlyClosed(1)).toEqual([]);
      response = 1;
      yield* close
        .handler({ id: "tab-1" }, sender)
        .pipe(Effect.provide(dependencies));
      expect(closed).toEqual(["tab-1"]);
      expect(parents).toEqual([1, 1]);
      expect(sessions.recentlyClosed(1)).toEqual([
        {
          id: 42,
          closedAt: 50,
          username: "Alice",
        },
      ]);
    }).pipe(Effect.provide(sessionsLayer)),
  );

  it.effect("closes idle clients without a confirmation", () =>
    Effect.gen(function* () {
      const sessions = yield* AccountSessions;
      sessions.openWindow(77, 1, 1);
      sessions.openWindow(42, 1, 1);
      const dependencies = Layer.mergeAll(
        Layer.mock(ElectronDialog, {}),
        Layer.mock(DesktopWindows, {
          closeRenderer: (id) =>
            Effect.sync(() => sessions.closeWindow(id, 50)),
        }),
      );
      yield* closeCurrent
        .handler(undefined, { kind: "game", rendererId: 42 })
        .pipe(Effect.provide(dependencies));
      expect(
        sessions.snapshot().map((session) => session.gameWindowId),
      ).toEqual([77]);
      expect(sessions.recentlyClosed(1)).toEqual([]);
    }).pipe(Effect.provide(sessionsLayer)),
  );

  it.effect(
    "rejects reopening at seven tabs and targets the requesting window when space exists",
    () =>
      Effect.gen(function* () {
        let count = 7;
        const reopened: unknown[] = [];
        const dependencies = Layer.mergeAll(
          Layer.mock(DesktopWindows, {
            getGameViewHostState: () =>
              Effect.succeed({
                ...hostState,
                sessions: Array.from({ length: count }, (_, index) => ({
                  id: `tab-${index + 1}`,
                  name: "Tab",
                  phase: "ready" as const,
                })),
              }),
            getRendererId: () => Effect.succeed(42),
            getNativeWindowId: () => Effect.succeed(1),
          }),
          Layer.mock(Accounts, {
            reopenGameWindow: (request) =>
              Effect.sync(() => {
                reopened.push(request);
                count += 1;
                return { gameWindowId: 43 };
              }),
          }),
        );
        const error = yield* Effect.flip(
          reopen.handler({ id: 9 }, sender).pipe(Effect.provide(dependencies)),
        );
        expect(error.message).toBe("Close a tab before reopening another.");
        count = 6;
        const state = yield* reopen
          .handler({ id: 9 }, sender)
          .pipe(Effect.provide(dependencies));
        expect(state.sessions).toHaveLength(7);
        expect(reopened).toEqual([
          {
            id: 9,
            gameWindowGroupId: 1,
            windowTarget: { kind: "same-as-game", gameWindowId: 42 },
          },
        ]);
      }),
  );
});
