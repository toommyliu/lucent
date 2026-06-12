import type { BrowserWindow, IpcMainInvokeEvent, WebContents } from "electron";
import { Effect, Layer } from "effect";
import { describe, expect, it, vi } from "vitest";
import { WindowIpcContracts } from "../../../shared/ipc";
import { WindowIds, type WindowId } from "../../../shared/windows";
import type { WindowStartupContext } from "../../window/WindowService";
import {
  WindowService,
  type WindowServiceShape,
} from "../../window/WindowService";
import { MainIpc, type MainIpcShape } from "../MainIpc";
import { registerWindowIpcHandlers } from "./window";

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

type CapturedHandler = (
  event: IpcMainInvokeEvent,
  ...args: readonly unknown[]
) => Effect.Effect<unknown, unknown, WindowService>;

const makeEvent = (windowId: number): IpcMainInvokeEvent => {
  const webContents = { id: windowId + 1 } as WebContents;
  electronMock.windowsByWebContents.set(webContents, { id: windowId });
  return { sender: webContents } as IpcMainInvokeEvent;
};

const makeWindowService = (options: {
  readonly contexts: ReadonlyMap<number, WindowStartupContext>;
  readonly openCalls: Array<{
    readonly id: WindowId;
    readonly senderWindowId?: number;
  }>;
  readonly closeCalls: number[];
}): WindowServiceShape => ({
  openGameWindow: () => Effect.die("not used"),
  openWindow: (id, senderWindowId) =>
    Effect.sync(() => {
      options.openCalls.push({
        id,
        ...(senderWindowId === undefined ? {} : { senderWindowId }),
      });
      return {} as BrowserWindow;
    }),
  getOpenWindow: () => Effect.succeed(null),
  getCursorDisplayWorkArea: () => Effect.die("not used"),
  revealGameWindow: () => Effect.void,
  revealWindowForAppActivation: () => Effect.void,
  getGameWindowId: (windowId) => Effect.succeed(windowId),
  getGameWindowIds: () => Effect.succeed([]),
  getGameChildWindow: () => Effect.succeed(null),
  getGameWindow: () => Effect.succeed(null),
  getWindowContext: (windowId) =>
    Effect.succeed(options.contexts.get(windowId)),
  requestCloseGameWindow: (gameWindowId) =>
    Effect.sync(() => {
      options.closeCalls.push(gameWindowId);
    }),
  setQuitting: () => Effect.void,
});

const makeIpc = (handlers: Map<string, CapturedHandler>): MainIpcShape => ({
  handle: (channel, handler) =>
    Effect.sync(() => {
      handlers.set(channel, handler as CapturedHandler);
    }),
  handleContract: (contract, handler) =>
    Effect.sync(() => {
      handlers.set(contract.channel, ((event, ...args) =>
        handler(event, ...contract.parseArgs(args)).pipe(
          Effect.map(contract.parseReturn),
        )) as CapturedHandler);
    }),
  on: () => Effect.void,
});

const withWindowIpc = async <A>(
  contexts: ReadonlyMap<number, WindowStartupContext>,
  body: (input: {
    readonly handlers: ReadonlyMap<string, CapturedHandler>;
    readonly openCalls: readonly {
      readonly id: WindowId;
      readonly senderWindowId?: number;
    }[];
    readonly closeCalls: readonly number[];
  }) => Effect.Effect<A, unknown, WindowService>,
): Promise<A> => {
  const handlers = new Map<string, CapturedHandler>();
  const openCalls: Array<{
    readonly id: WindowId;
    readonly senderWindowId?: number;
  }> = [];
  const closeCalls: number[] = [];
  const ipc = makeIpc(handlers);
  const windows = makeWindowService({ contexts, openCalls, closeCalls });

  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        yield* registerWindowIpcHandlers();
        return yield* body({ handlers, openCalls, closeCalls });
      }),
    ).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(MainIpc)(ipc),
          Layer.succeed(WindowService)(windows),
        ),
      ),
    ),
  );
};

describe("window IPC sender authorization", () => {
  it("rejects app senders opening game-child tools", async () => {
    await expect(
      withWindowIpc(
        new Map([
          [
            1,
            {
              kind: "app",
              id: WindowIds.AccountManager,
              label: "Account Manager",
            },
          ],
        ]),
        ({ handlers }) =>
          handlers.get(WindowIpcContracts.open.channel)!(
            makeEvent(1),
            WindowIds.FastTravels,
          ),
      ),
    ).rejects.toThrow("Sender cannot open game tool window");
  });

  it("allows game senders opening game-child tools", async () => {
    const result = await withWindowIpc(
      new Map([[7, { kind: "game", label: "Game" }]]),
      ({ handlers, openCalls }) =>
        Effect.gen(function* () {
          yield* handlers.get(WindowIpcContracts.open.channel)!(
            makeEvent(7),
            WindowIds.FastTravels,
          );
          return openCalls;
        }),
    );

    expect(result).toEqual([{ id: WindowIds.FastTravels, senderWindowId: 7 }]);
  });

  it("rejects child-window game close requests", async () => {
    await expect(
      withWindowIpc(
        new Map([
          [
            11,
            {
              kind: "game-child",
              id: WindowIds.Packets,
              label: "Packets",
            },
          ],
        ]),
        ({ handlers }) =>
          handlers.get(WindowIpcContracts.requestCloseGameWindow.channel)!(
            makeEvent(11),
          ),
      ),
    ).rejects.toThrow("IPC sender must be a game window");
  });
});
