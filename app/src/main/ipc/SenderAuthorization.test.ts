import type { WebContents } from "electron";
import { Effect, Layer } from "effect";
import { describe, expect, it, vi } from "vitest";
import { WindowIds } from "../../shared/windows";
import {
  WindowService,
  type WindowServiceShape,
  type WindowStartupContext,
} from "../window/WindowService";
import {
  requireAccountManagerSender,
  requireGameWindowSender,
} from "./SenderAuthorization";

const electronMock = vi.hoisted(() => {
  const windowsByWebContents = new WeakMap<object, unknown>();

  return {
    windowsByWebContents,
    BrowserWindow: {
      fromWebContents: vi.fn(
        (webContents: object) => windowsByWebContents.get(webContents) ?? null,
      ),
    },
  };
});

vi.mock("electron", () => ({
  BrowserWindow: electronMock.BrowserWindow,
}));

const makeSender = (windowId: number): WebContents => {
  const webContents = { id: windowId + 1 } as WebContents;
  electronMock.windowsByWebContents.set(webContents, { id: windowId });
  return webContents;
};

const makeWindowService = (
  contexts: ReadonlyMap<number, WindowStartupContext>,
): WindowServiceShape => ({
  openGameWindow: () => Effect.die("not used"),
  openWindow: () => Effect.die("not used"),
  getOpenWindow: () => Effect.succeed(null),
  getCursorDisplayWorkArea: () => Effect.die("not used"),
  revealGameWindow: () => Effect.void,
  revealWindowForAppActivation: () => Effect.void,
  getGameWindowId: () => Effect.succeed(undefined),
  getGameWindowIds: () => Effect.succeed([]),
  getGameChildWindow: () => Effect.succeed(null),
  getGameWindow: () => Effect.succeed(null),
  getWindowContext: (windowId) => Effect.succeed(contexts.get(windowId)),
  requestCloseGameWindow: () => Effect.void,
  setQuitting: () => Effect.void,
});

const runWithContexts = (
  contexts: ReadonlyMap<number, WindowStartupContext>,
  effect: Effect.Effect<void, unknown, WindowService>,
): Promise<void> =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(Layer.succeed(WindowService)(makeWindowService(contexts))),
    ),
  );

describe("sender authorization", () => {
  it("rejects account-manager access from other app windows", async () => {
    await expect(
      runWithContexts(
        new Map([
          [
            2,
            {
              kind: "app",
              id: WindowIds.Settings,
              label: "Settings",
            },
          ],
        ]),
        requireAccountManagerSender(makeSender(2)),
      ),
    ).rejects.toThrow("IPC sender must be the Account Manager window");
  });

  it("rejects game-only access from game-child windows", async () => {
    await expect(
      runWithContexts(
        new Map([
          [
            4,
            {
              kind: "game-child",
              id: WindowIds.Packets,
              label: "Packets",
            },
          ],
        ]),
        requireGameWindowSender(makeSender(4)),
      ),
    ).rejects.toThrow("IPC sender must be a game window");
  });

  it("allows game-only access from game windows", async () => {
    await expect(
      runWithContexts(
        new Map([[6, { kind: "game", label: "Game" }]]),
        requireGameWindowSender(makeSender(6)),
      ),
    ).resolves.toBeUndefined();
  });
});
