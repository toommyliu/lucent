import { describe, expect, it } from "@effect/vitest";
import type { IpcMainInvokeEvent, WebContents } from "electron";
import * as Effect from "effect/Effect";

import type { DesktopRendererKind } from "../window/DesktopWindowCatalog";
import type { DesktopWindows } from "../window/DesktopWindows";
import {
  DesktopIpcSenderError,
  makeDesktopIpcSenders,
} from "./DesktopIpcSenders";

const webContents = {} as WebContents;
const event = { sender: webContents } as IpcMainInvokeEvent;

const makeWindows = (
  kind: DesktopRendererKind | null,
): DesktopWindows["Service"] =>
  ({
    getBrowserWindowKind: () => Effect.succeed(kind),
  }) as unknown as DesktopWindows["Service"];

describe("DesktopIpcSenders", () => {
  it.effect("resolves an allowed sender with its managed window identity", () =>
    Effect.gen(function* () {
      const senders = makeDesktopIpcSenders(makeWindows("game"), {
        getWebContentsId: () => 42,
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
        getWebContentsId: () => 42,
      });

      const error = yield* Effect.flip(senders.require(event, ["game"]));

      expect(error).toBeInstanceOf(DesktopIpcSenderError);
      expect(error.message).toBe("IPC sender must be one of: game");
    }),
  );

  it.effect("rejects unmanaged web contents", () =>
    Effect.gen(function* () {
      const unmanagedWindows = makeWindows(null);
      const unmanagedSenders = makeDesktopIpcSenders(unmanagedWindows, {
        getWebContentsId: () => 404,
      });

      const error = yield* Effect.flip(
        unmanagedSenders.require(event, ["game"]),
      );

      expect(error).toBeInstanceOf(DesktopIpcSenderError);
      expect(error.message).toBe("IPC sender must be one of: game");
    }),
  );
});
