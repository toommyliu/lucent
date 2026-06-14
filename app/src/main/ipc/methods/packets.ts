import type { IpcMainInvokeEvent } from "electron";
import { Effect, Scope } from "effect";
import {
  PacketsIpcChannels,
  type PacketsRequestKind,
  type PacketsRequestMessage,
  type PacketsResponseMessage,
} from "../../../shared/ipc";
import {
  isPacketCaptureType,
  isPacketSendTarget,
  normalizePacketQueuePayload,
  type PacketCapturedPayload,
  type PacketSendPayload,
  type PacketsStatusPayload,
} from "../../../shared/packets";
import { WindowIds } from "../../../shared/windows";
import {
  WindowManagerError,
  WindowOperationError,
  WindowService,
  type GameWindowRef,
  type WindowEffectRunner,
} from "../../window/WindowService";
import {
  GameWindowClient,
  type GameWindowClientShape,
} from "../../window/GameWindowClient";
import { DesktopIpc } from "../DesktopIpc";
import {
  getSenderGameWindow,
  getSenderGameWindowIds,
  requireGameWindowSender,
} from "../DesktopIpcRequest";

const PACKETS_REQUEST_TIMEOUT_MS = 5_000;

const requestErrorMessage = (cause: unknown): string =>
  cause instanceof Error && cause.message !== ""
    ? cause.message
    : "Packet request failed";

const requestGamePackets = (
  gameClient: GameWindowClientShape,
  gameWindow: GameWindowRef,
  kind: PacketsRequestKind,
  payload?: unknown,
): Effect.Effect<void, Error | WindowManagerError, WindowService> =>
  gameClient.request({
    target: gameWindow,
    requestChannel: PacketsIpcChannels.request,
    timeoutMs: PACKETS_REQUEST_TIMEOUT_MS,
    timeoutError: "Packets did not respond",
    sendError: "Packet request failed",
    makeMessage: (requestId): PacketsRequestMessage => ({
      requestId,
      kind,
      ...(payload === undefined ? {} : { payload }),
    }),
  });

const sendPacketsRequest = (
  event: IpcMainInvokeEvent,
  gameClient: GameWindowClientShape,
  kind: PacketsRequestKind,
  payload?: unknown,
): Effect.Effect<void, WindowManagerError, WindowService> =>
  Effect.gen(function* () {
    const { gameWindow } = yield* getSenderGameWindow(event.sender);

    return yield* requestGamePackets(
      gameClient,
      gameWindow,
      kind,
      payload,
    ).pipe(
      Effect.mapError(
        (cause) =>
          new WindowOperationError({
            message: requestErrorMessage(cause),
            cause,
          }),
      ),
    );
  });

const normalizeSendPayload = (payload: unknown): PacketSendPayload => {
  const record = payload as Partial<PacketSendPayload> | null;
  if (!record || typeof record.packet !== "string") {
    throw new Error("Packet payload is required");
  }

  if (!isPacketSendTarget(record.target)) {
    throw new Error("Invalid packet send target");
  }

  return {
    packet: record.packet,
    target: record.target,
  };
};

const normalizeCapturedPayload = (
  payload: unknown,
): PacketCapturedPayload | null => {
  const record = payload as Partial<PacketCapturedPayload> | null;
  if (!record || typeof record.packet !== "string") {
    return null;
  }

  if (!isPacketCaptureType(record.type)) {
    return null;
  }

  return {
    capturedAt:
      typeof record.capturedAt === "number" &&
      Number.isFinite(record.capturedAt)
        ? record.capturedAt
        : Date.now(),
    packet: record.packet,
    type: record.type,
  };
};

const normalizeStatusPayload = (
  payload: unknown,
): PacketsStatusPayload | null => {
  const record = payload as Partial<PacketsStatusPayload> | null;
  if (
    !record ||
    typeof record.captureRunning !== "boolean" ||
    typeof record.queueRunning !== "boolean"
  ) {
    return null;
  }

  return {
    captureRunning: record.captureRunning,
    queueRunning: record.queueRunning,
    ...(typeof record.stoppedReason === "string" && record.stoppedReason !== ""
      ? { stoppedReason: record.stoppedReason }
      : {}),
  };
};

export const registerPacketsIpcHandlers = (
  runWindowEffect: WindowEffectRunner,
): Effect.Effect<void, never, GameWindowClient | DesktopIpc | Scope.Scope> =>
  Effect.gen(function* () {
    const ipc = yield* DesktopIpc;
    const gameClient = yield* GameWindowClient;
    const run = <A>(
      effect: Effect.Effect<A, WindowManagerError, WindowService>,
    ) => Effect.promise(() => runWindowEffect(effect));

    yield* ipc.on(PacketsIpcChannels.response, (event, response) =>
      run(
        Effect.gen(function* () {
          yield* requireGameWindowSender(event.sender);
          const packetResponse = response as PacketsResponseMessage;
          if (typeof packetResponse?.requestId !== "string") {
            return;
          }

          if (packetResponse.ok) {
            const { gameWindow } = yield* getSenderGameWindow(event.sender);
            yield* gameClient.resolve(
              packetResponse.requestId,
              gameWindow,
              undefined,
            );
          } else {
            const { gameWindow } = yield* getSenderGameWindow(event.sender);
            yield* gameClient.resolve(
              packetResponse.requestId,
              gameWindow,
              new Error(packetResponse.error || "Packet request failed"),
            );
          }
        }),
      ),
    );

    yield* ipc.handle(PacketsIpcChannels.startCapture, (event) =>
      run(sendPacketsRequest(event, gameClient, "startCapture")),
    );

    yield* ipc.handle(PacketsIpcChannels.stopCapture, (event) =>
      run(sendPacketsRequest(event, gameClient, "stopCapture")),
    );

    yield* ipc.handle(PacketsIpcChannels.send, (event, payload) =>
      run(
        sendPacketsRequest(
          event,
          gameClient,
          "send",
          normalizeSendPayload(payload),
        ),
      ),
    );

    yield* ipc.handle(PacketsIpcChannels.startQueue, (event, payload) =>
      run(
        sendPacketsRequest(
          event,
          gameClient,
          "startQueue",
          normalizePacketQueuePayload(payload),
        ),
      ),
    );

    yield* ipc.handle(PacketsIpcChannels.stopQueue, (event) =>
      run(sendPacketsRequest(event, gameClient, "stopQueue")),
    );

    yield* ipc.handle(PacketsIpcChannels.publishCaptured, (event, payload) =>
      run(
        Effect.gen(function* () {
          yield* requireGameWindowSender(event.sender);
          const { gameWindowId } = yield* getSenderGameWindowIds(event.sender);
          const captured = normalizeCapturedPayload(payload);
          if (!captured) {
            return;
          }

          const windows = yield* WindowService;
          const packetsWindow = yield* windows.getGameChildWindowRef(
            gameWindowId,
            WindowIds.Packets,
          );

          if (packetsWindow) {
            yield* windows
              .sendToWindow(
                packetsWindow,
                PacketsIpcChannels.captured,
                captured,
              )
              .pipe(Effect.ignore);
          }
        }),
      ),
    );

    yield* ipc.handle(PacketsIpcChannels.publishStatus, (event, payload) =>
      run(
        Effect.gen(function* () {
          yield* requireGameWindowSender(event.sender);
          const { gameWindowId } = yield* getSenderGameWindowIds(event.sender);
          const status = normalizeStatusPayload(payload);
          if (!status) {
            return;
          }

          const windows = yield* WindowService;
          const packetsWindow = yield* windows.getGameChildWindowRef(
            gameWindowId,
            WindowIds.Packets,
          );

          if (packetsWindow) {
            yield* windows
              .sendToWindow(packetsWindow, PacketsIpcChannels.status, status)
              .pipe(Effect.ignore);
          }
        }),
      ),
    );
  });
