import {
  BrowserWindow,
  ipcMain,
  webContents,
  type IpcMainInvokeEvent,
} from "electron";

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";

import {
  type ElectronWindowUsabilityTarget,
  isElectronWindowUsable,
} from "../electron/windowUsability";
import type { DesktopRendererKind } from "../window/DesktopWindowCatalog";
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

export interface DesktopIpcWindow extends ElectronWindowUsabilityTarget {
  readonly webContents: ElectronWindowUsabilityTarget["webContents"] & {
    readonly send: (channel: string, payload: unknown) => void;
  };
  readonly getBrowserViews?: () => readonly DesktopIpcView[];
}

export interface DesktopIpcView {
  readonly webContents: DesktopIpcWebContents;
}

export interface DesktopIpcWebContents {
  readonly isDestroyed: () => boolean;
  readonly send: (channel: string, payload: unknown) => void;
}

export interface DesktopIpcWindows {
  readonly getAllWindows: () => readonly DesktopIpcWindow[];
}

export interface DesktopIpcWebContentsCatalog {
  readonly fromId: (id: number) => DesktopIpcWebContents | undefined;
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
  readonly sendToRendererIds: <Descriptor extends IpcEventDescriptor<unknown>>(
    rendererIds: readonly number[],
    descriptor: Descriptor,
    payload: IpcEventPayload<Descriptor>,
  ) => Effect.Effect<void>;
}

export class DesktopIpc extends Context.Service<DesktopIpc, DesktopIpcShape>()(
  "lucent/desktop/ipc/DesktopIpc",
) {}

const sendEncoded = (
  targets: Iterable<DesktopIpcWebContents | undefined>,
  channel: string,
  payload: unknown,
): void => {
  const unexpectedFailures: unknown[] = [];
  for (const target of targets) {
    if (target === undefined || target.isDestroyed()) {
      continue;
    }

    try {
      target.send(channel, payload);
    } catch (cause) {
      if (!target.isDestroyed()) {
        unexpectedFailures.push(cause);
      }
    }
  }

  if (unexpectedFailures.length > 0) {
    throw unexpectedFailures[0];
  }
};

export const makeDesktopIpc = (
  main: DesktopIpcMain,
  windows: DesktopIpcWindows = BrowserWindow,
  contents: DesktopIpcWebContentsCatalog = webContents,
): DesktopIpc["Service"] => {
  const sendEvent = <Descriptor extends IpcEventDescriptor<unknown>>(
    descriptor: Descriptor,
    payload: IpcEventPayload<Descriptor>,
    targets: () => Iterable<DesktopIpcWebContents | undefined>,
  ): Effect.Effect<void> =>
    descriptor.encodePayloadEffect(payload).pipe(
      Effect.orDie,
      Effect.flatMap((encoded) =>
        Effect.sync(() => sendEncoded(targets(), descriptor.channel, encoded)),
      ),
    );

  const allWebContents = function* (): Generator<DesktopIpcWebContents> {
    for (const window of windows.getAllWindows()) {
      if (!isElectronWindowUsable(window)) {
        continue;
      }

      yield window.webContents;
      for (const view of window.getBrowserViews?.() ?? []) {
        yield view.webContents;
      }
    }
  };

  const sendToAll: DesktopIpcShape["sendToAll"] = (descriptor, payload) =>
    sendEvent(descriptor, payload, allWebContents);

  const sendToRendererIds: DesktopIpcShape["sendToRendererIds"] = (
    rendererIds,
    descriptor,
    payload,
  ) =>
    sendEvent(descriptor, payload, () =>
      rendererIds.map((rendererId) => contents.fromId(rendererId)),
    );

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
    sendToRendererIds,
  });
};

export const layer = Layer.succeed(DesktopIpc, makeDesktopIpc(ipcMain));

export const ALL_DESKTOP_RENDERER_KINDS = [
  "account-manager",
  "combat-profiles",
  "environment",
  "follower",
  "game",
  "game-group-controls",
  "game-host",
  "loader-grabber",
  "packets",
  "settings",
] as const satisfies readonly [DesktopRendererKind, ...DesktopRendererKind[]];
