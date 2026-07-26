import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from "electron";

import { Context, Effect, Layer, Schema, Scope } from "effect";

import { isElectronWindowUsable } from "../electron/windowUsability";
import type { DesktopWindowKind } from "../window/DesktopWindowCatalog";
import {
  type IpcEventDescriptor,
  type IpcEventPayload,
  type IpcInvokeDescriptor,
  type IpcInvokePayload,
  type IpcInvokeResult,
} from "../../shared/ipc";
import { createDesktopIpcInvokeHandler } from "./DesktopIpcInvoke";
import {
  type DesktopIpcSender,
  type DesktopIpcSenderKinds,
  DesktopIpcSenders,
} from "./DesktopIpcSenders";

export interface DesktopIpcMethodRegistration<E, R> {
  readonly allowedSenders: DesktopIpcSenderKinds;
  readonly descriptor: IpcInvokeDescriptor<unknown, unknown>;
  readonly invoke: (
    payload: unknown,
    sender: DesktopIpcSender,
  ) => Effect.Effect<unknown, E, R>;
}

export type DesktopIpcMethod<
  Descriptor extends IpcInvokeDescriptor<unknown, unknown>,
  E,
  R,
> = DesktopIpcMethodRegistration<E, R> & {
  readonly descriptor: Descriptor;
  readonly handler: (
    payload: IpcInvokePayload<Descriptor>,
    sender: DesktopIpcSender,
  ) => Effect.Effect<IpcInvokeResult<Descriptor>, E, R>;
};

export const makeDesktopIpcMethod = <
  Descriptor extends IpcInvokeDescriptor<unknown, unknown>,
  E,
  R,
>(method: {
  readonly allowedSenders: DesktopIpcSenderKinds;
  readonly descriptor: Descriptor;
  readonly handler: (
    payload: IpcInvokePayload<Descriptor>,
    sender: DesktopIpcSender,
  ) => Effect.Effect<IpcInvokeResult<Descriptor>, E, R>;
}): DesktopIpcMethod<Descriptor, E, R> => ({
  ...method,
  invoke: (payload, sender) =>
    method.handler(payload as IpcInvokePayload<Descriptor>, sender),
});

export class DesktopIpcRegistrationError extends Schema.TaggedErrorClass<DesktopIpcRegistrationError>()(
  "DesktopIpcRegistrationError",
  {
    channel: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to register the IPC handler for ${this.channel}.`;
  }
}

export class DesktopIpcUnregistrationError extends Schema.TaggedErrorClass<DesktopIpcUnregistrationError>()(
  "DesktopIpcUnregistrationError",
  {
    channel: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to unregister the IPC handler for ${this.channel}.`;
  }
}

export interface DesktopIpcMain {
  readonly handle: (
    channel: string,
    listener: (event: IpcMainInvokeEvent, payload: unknown) => Promise<unknown>,
  ) => void;
  readonly removeHandler: (channel: string) => void;
}

export interface DesktopIpcShape {
  readonly handle: <E, R>(
    method: DesktopIpcMethodRegistration<E, R>,
  ) => Effect.Effect<
    void,
    DesktopIpcRegistrationError,
    DesktopIpcSenders | R | Scope.Scope
  >;
  readonly sendToAll: <Descriptor extends IpcEventDescriptor<unknown>>(
    descriptor: Descriptor,
    payload: IpcEventPayload<Descriptor>,
  ) => Effect.Effect<void>;
  readonly sendToBrowserWindowIds: <
    Descriptor extends IpcEventDescriptor<unknown>,
  >(
    browserWindowIds: readonly number[],
    descriptor: Descriptor,
    payload: IpcEventPayload<Descriptor>,
  ) => Effect.Effect<void>;
}

export class DesktopIpc extends Context.Service<DesktopIpc, DesktopIpcShape>()(
  "lucent/desktop/ipc/DesktopIpc",
) {}

const sendToAll: DesktopIpcShape["sendToAll"] = (descriptor, payload) =>
  Schema.encodeUnknownEffect(descriptor.payload)(payload).pipe(
    Effect.flatMap((encoded) =>
      Effect.sync(() => {
        for (const window of BrowserWindow.getAllWindows()) {
          if (isElectronWindowUsable(window)) {
            window.webContents.send(descriptor.channel, encoded);
          }
        }
      }),
    ),
    Effect.catch(() => Effect.void),
  );

const sendToBrowserWindowIds: DesktopIpcShape["sendToBrowserWindowIds"] = (
  browserWindowIds,
  descriptor,
  payload,
) =>
  Schema.encodeUnknownEffect(descriptor.payload)(payload).pipe(
    Effect.flatMap((encoded) =>
      Effect.sync(() => {
        for (const browserWindowId of browserWindowIds) {
          const window = BrowserWindow.fromId(browserWindowId);
          if (window !== null && isElectronWindowUsable(window)) {
            window.webContents.send(descriptor.channel, encoded);
          }
        }
      }),
    ),
    Effect.catch(() => Effect.void),
  );

export const makeDesktopIpc = (main: DesktopIpcMain): DesktopIpc["Service"] => {
  const handle = <E, R>(
    method: DesktopIpcMethodRegistration<E, R>,
  ): Effect.Effect<
    void,
    DesktopIpcRegistrationError,
    DesktopIpcSenders | R | Scope.Scope
  > =>
    Effect.gen(function* () {
      const senders = yield* DesktopIpcSenders;
      const context = yield* Effect.context<R>();
      const runPromise = Effect.runPromiseWith(context);
      const { descriptor } = method;

      yield* Effect.acquireRelease(
        Effect.try({
          try: () =>
            main.handle(
              descriptor.channel,
              createDesktopIpcInvokeHandler(
                descriptor,
                (payload, event) =>
                  senders
                    .require(event, method.allowedSenders)
                    .pipe(
                      Effect.flatMap((sender) =>
                        method.invoke(payload, sender),
                      ),
                    ),
                runPromise,
              ),
            ),
          catch: (cause) =>
            new DesktopIpcRegistrationError({
              channel: descriptor.channel,
              cause,
            }),
        }),
        () =>
          Effect.try({
            try: () => main.removeHandler(descriptor.channel),
            catch: (cause) =>
              new DesktopIpcUnregistrationError({
                channel: descriptor.channel,
                cause,
              }),
          }).pipe(Effect.orDie),
      );
    });

  return DesktopIpc.of({
    handle,
    sendToAll,
    sendToBrowserWindowIds,
  });
};

export const layer = Layer.succeed(DesktopIpc, makeDesktopIpc(ipcMain));

export const ALL_DESKTOP_WINDOW_KINDS = [
  "account-manager",
  "combat-profiles",
  "environment",
  "follower",
  "game",
  "loader-grabber",
  "settings",
] as const satisfies readonly [DesktopWindowKind, ...DesktopWindowKind[]];
