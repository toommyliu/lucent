import { describe, expect, it } from "@effect/vitest";
import type { IpcMainInvokeEvent } from "electron";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";

import { defineEvent, defineInvoke } from "../../shared/ipc";
import {
  DesktopIpcRegistrationError,
  makeDesktopIpc,
  makeDesktopIpcMethod,
  type DesktopIpcMain,
  type DesktopIpcWindow,
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

const eventDescriptor = defineEvent({
  channel: "desktop:test:event",
  name: "test.event",
  payload: Schema.String,
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

  it.effect("continues delivery after a destroyed-window race", () =>
    Effect.gen(function* () {
      const { main } = makeIpcMain();
      const delivered: string[] = [];
      let destroyed = false;
      const racedWindow: DesktopIpcWindow = {
        isDestroyed: () => destroyed,
        webContents: {
          isDestroyed: () => destroyed,
          send: () => {
            destroyed = true;
            throw new Error("Window was destroyed during delivery.");
          },
        },
      };
      const receivingWindow: DesktopIpcWindow = {
        isDestroyed: () => false,
        webContents: {
          isDestroyed: () => false,
          send: (_channel, payload) => {
            delivered.push(String(payload));
          },
        },
      };
      const ipc = makeDesktopIpc(main, {
        getAllWindows: () => [racedWindow, receivingWindow],
      });

      yield* ipc.sendToAll(eventDescriptor, "hello");

      expect(delivered).toEqual(["hello"]);
    }),
  );

  it.effect(
    "reports unexpected delivery failures after attempting every recipient",
    () =>
      Effect.gen(function* () {
        const { main } = makeIpcMain();
        const delivered: string[] = [];
        const failingWindow: DesktopIpcWindow = {
          isDestroyed: () => false,
          webContents: {
            isDestroyed: () => false,
            send: () => {
              throw new Error("Unexpected IPC transport failure.");
            },
          },
        };
        const receivingWindow: DesktopIpcWindow = {
          isDestroyed: () => false,
          webContents: {
            isDestroyed: () => false,
            send: (_channel, payload) => {
              delivered.push(String(payload));
            },
          },
        };
        const ipc = makeDesktopIpc(main, {
          getAllWindows: () => [failingWindow, receivingWindow],
        });

        const exit = yield* Effect.exit(
          ipc.sendToAll(eventDescriptor, "hello"),
        );

        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          expect(Cause.squash(exit.cause)).toMatchObject({
            message: "Unexpected IPC transport failure.",
          });
        }
        expect(delivered).toEqual(["hello"]);
      }),
  );

  it.effect("delivers events to hosted views and renderer ids", () =>
    Effect.gen(function* () {
      const { main } = makeIpcMain();
      const delivered: string[] = [];
      const hostedContents = {
        isDestroyed: () => false,
        send: (_channel: string, payload: unknown) => {
          delivered.push(`view:${String(payload)}`);
        },
      };
      const hostWindow: DesktopIpcWindow = {
        getBrowserViews: () => [{ webContents: hostedContents }],
        isDestroyed: () => false,
        webContents: {
          isDestroyed: () => false,
          send: (_channel, payload) => {
            delivered.push(`host:${String(payload)}`);
          },
        },
      };
      const ipc = makeDesktopIpc(
        main,
        { getAllWindows: () => [hostWindow] },
        { fromId: (id) => (id === 42 ? hostedContents : undefined) },
      );

      yield* ipc.sendToAll(eventDescriptor, "all");
      yield* ipc.sendToBrowserWindowIds([42, 404], eventDescriptor, "target");

      expect(delivered).toEqual(["host:all", "view:all", "view:target"]);
    }),
  );
});
