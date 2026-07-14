import { describe, expect, it } from "@effect/vitest";
import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import { Effect, Schema } from "effect";

import { defineInvoke } from "../../shared/ipc";
import {
  DesktopIpcRegistrationError,
  makeDesktopIpc,
  makeDesktopIpcMethod,
  type DesktopIpcMain,
} from "./DesktopIpc";
import {
  DesktopIpcSenders,
  type DesktopIpcSendersShape,
} from "./DesktopIpcSenders";

const descriptor = defineInvoke({
  channel: "desktop:test:echo",
  name: "test.echo",
  payload: Schema.String,
  result: Schema.String,
});

const method = makeDesktopIpcMethod({
  descriptor,
  allowedSenders: ["game"],
  handler: (payload, sender) =>
    Effect.succeed(`${payload}:${sender.browserWindowId}`),
});

const senders = DesktopIpcSenders.of({
  require: (_event, allowedKinds) =>
    Effect.sync(() => {
      expect(allowedKinds).toEqual(["game"]);
      return {
        browserWindow: { id: 42 } as BrowserWindow,
        browserWindowId: 42,
        kind: "game" as const,
      };
    }),
} satisfies DesktopIpcSendersShape);

const makeIpcMain = () => {
  const handlers = new Map<string, Parameters<DesktopIpcMain["handle"]>[1]>();
  const main: DesktopIpcMain = {
    handle: (channel, listener) => {
      if (handlers.has(channel)) {
        throw new Error(`Handler already registered: ${channel}`);
      }
      handlers.set(channel, listener);
    },
    removeHandler: (channel) => {
      handlers.delete(channel);
    },
  };
  return { handlers, main };
};

describe("DesktopIpc", () => {
  it.effect("runs a typed method with its resolved sender", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { handlers, main } = makeIpcMain();
        const ipc = makeDesktopIpc(main);
        yield* ipc.handle(method);
        const listener = handlers.get(descriptor.channel);

        expect(listener).toBeDefined();
        const envelope = yield* Effect.promise(() =>
          listener!({} as IpcMainInvokeEvent, "hello"),
        );

        expect(envelope).toEqual({ ok: true, value: "hello:42" });
      }).pipe(Effect.provideService(DesktopIpcSenders, senders)),
    ),
  );

  it.effect(
    "fails duplicate handler registration instead of replacing it",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { main } = makeIpcMain();
          const ipc = makeDesktopIpc(main);
          yield* ipc.handle(method);

          const error = yield* Effect.flip(ipc.handle(method));

          expect(error).toBeInstanceOf(DesktopIpcRegistrationError);
          expect(error.channel).toBe(descriptor.channel);
        }).pipe(Effect.provideService(DesktopIpcSenders, senders)),
      ),
  );
});
