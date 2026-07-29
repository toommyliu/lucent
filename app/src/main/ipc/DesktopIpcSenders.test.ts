import { describe, expect, it } from "@effect/vitest";
import type { BrowserWindow, IpcMainInvokeEvent, WebContents } from "electron";
import * as Effect from "effect/Effect";

import type { DesktopWindowKind } from "../window/DesktopWindowCatalog";
import type { DesktopWindows } from "../window/DesktopWindows";
import {
  DesktopIpcSenderError,
  makeDesktopIpcSenders,
} from "./DesktopIpcSenders";

const webContents = {} as WebContents;
const event = { sender: webContents } as IpcMainInvokeEvent;
const browserWindow = { id: 42 } as BrowserWindow;

const makeWindows = (
  kind: DesktopWindowKind | null,
): DesktopWindows["Service"] =>
  ({
    getBrowserWindowKind: () => Effect.succeed(kind),
  }) as unknown as DesktopWindows["Service"];

describe("DesktopIpcSenders", () => {
  it.effect("resolves an allowed sender with its managed window identity", () =>
    Effect.gen(function* () {
      const senders = makeDesktopIpcSenders(makeWindows("game"), {
        fromWebContents: () => browserWindow,
      });

      const sender = yield* senders.require(event, ["game"]);

      expect(sender).toEqual({
        browserWindowId: 42,
        kind: "game",
      });
    }),
  );

  it.effect("rejects a managed window of the wrong kind", () =>
    Effect.gen(function* () {
      const senders = makeDesktopIpcSenders(makeWindows("settings"), {
        fromWebContents: () => browserWindow,
      });

      const error = yield* Effect.flip(senders.require(event, ["game"]));

      expect(error).toBeInstanceOf(DesktopIpcSenderError);
      expect(error.message).toBe("IPC sender must be one of: game");
    }),
  );

  it.effect("rejects web contents without an owning BrowserWindow", () =>
    Effect.gen(function* () {
      const senders = makeDesktopIpcSenders(makeWindows("game"), {
        fromWebContents: () => null,
      });

      const error = yield* Effect.flip(senders.require(event, ["game"]));

      expect(error).toBeInstanceOf(DesktopIpcSenderError);
      expect(error.message).toBe(
        "IPC sender is not attached to a BrowserWindow.",
      );
    }),
  );
});
