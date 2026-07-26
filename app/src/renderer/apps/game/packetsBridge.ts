import { Effect, Schema } from "effect";

import {
  clampPacketQueueDelay,
  normalizePacketQueuePayload,
  type PacketQueuePayload,
  type PacketSendPayload,
  type PacketSendTarget,
} from "../../../shared/packets";
import type {
  PacketsRequest,
  PacketsResponse,
} from "../../../shared/ipc/packets";
import { Api } from "./flash";
import type { ClientPacketSendType } from "./flash/api/Packet";
import type { flashRuntime } from "./flash";

type GameRuntime = Pick<typeof flashRuntime, "runPromise">;

interface QueueState {
  readonly delayMs: number;
  readonly packets: readonly string[];
  readonly target: PacketSendTarget;
  index: number;
  stopped: boolean;
  timeout: ReturnType<typeof setTimeout> | undefined;
}

export class PacketOperationError extends Schema.TaggedErrorClass<PacketOperationError>()(
  "PacketOperationError",
  {
    detail: Schema.String,
  },
) {
  override get message(): string {
    return this.detail;
  }
}

export interface PacketsBridgeController {
  readonly dispose: () => void;
  readonly stopActive: (stoppedReason?: string) => void;
}

const errorMessage = (cause: unknown): string =>
  cause instanceof Error && cause.message !== ""
    ? cause.message
    : "The packet request failed.";

const sendPacketEffect = Effect.fn("packetsBridge.sendPacket")(function* (
  payload: PacketSendPayload,
) {
  const api = yield* Api;
  let sent: boolean;

  if (payload.target === "server-string") {
    sent = yield* api.packet.sendServer(payload.packet, "String");
  } else if (payload.target === "server-json") {
    sent = yield* api.packet.sendServer(payload.packet, "Json");
  } else {
    const clientType: ClientPacketSendType =
      payload.target === "client-json"
        ? "json"
        : payload.target === "client-xml"
          ? "xml"
          : "str";
    sent = yield* api.packet.sendClient(payload.packet, clientType);
  }

  if (!sent) {
    return yield* new PacketOperationError({
      detail: "The game rejected the packet send request.",
    });
  }
});

const sendResponse = (response: PacketsResponse): Promise<void> => {
  const packets = window.desktop.packets;
  return packets === undefined
    ? Promise.reject(new Error("The Packets desktop bridge is unavailable."))
    : packets.respond(response);
};

export const installPacketsBridge = (
  runtime: GameRuntime,
): PacketsBridgeController => {
  const packetsBridge = window.desktop.packets;
  if (packetsBridge === undefined) {
    return {
      dispose: () => undefined,
      stopActive: () => undefined,
    };
  }

  let captureDispose: (() => void) | undefined;
  let captureGeneration = 0;
  let connectionDispose: (() => void) | undefined;
  let disposed = false;
  let queueState: QueueState | undefined;
  let requests = Promise.resolve();

  const publishStatus = (stoppedReason?: string): void => {
    void packetsBridge
      .publishStatus({
        captureRunning: captureDispose !== undefined,
        queueRunning: queueState !== undefined && !queueState.stopped,
        ...(stoppedReason === undefined ? {} : { stoppedReason }),
      })
      .catch((cause: unknown) => {
        console.error("[game:packets] failed to publish status", cause);
      });
  };

  const stopCapture = (publish = true): void => {
    const wasRunning = captureDispose !== undefined;
    captureGeneration += 1;
    captureDispose?.();
    captureDispose = undefined;
    if (publish && wasRunning) {
      publishStatus();
    }
  };

  const startCapture = async (): Promise<void> => {
    stopCapture(false);
    const generation = captureGeneration + 1;
    captureGeneration = generation;
    const dispose = await runtime.runPromise(
      Effect.gen(function* () {
        const api = yield* Api;
        return yield* api.packet.onRaw((packet) =>
          Effect.promise(() =>
            packetsBridge
              .publishCaptured({
                capturedAt: Date.now(),
                packet: packet.raw,
                type: packet.direction,
              })
              .catch((cause: unknown) => {
                console.error(
                  "[game:packets] failed to publish captured packet",
                  cause,
                );
              }),
          ),
        );
      }),
    );

    if (disposed || generation !== captureGeneration) {
      dispose();
      throw new Error("Packet capture start was interrupted.");
    }
    captureDispose = dispose;
    publishStatus();
  };

  const sendPacket = (payload: PacketSendPayload): Promise<void> =>
    runtime.runPromise(sendPacketEffect(payload));

  const clearQueueTimer = (): void => {
    if (queueState?.timeout !== undefined) {
      clearTimeout(queueState.timeout);
      queueState.timeout = undefined;
    }
  };

  const stopQueue = (publish = true): void => {
    const wasRunning = queueState !== undefined && !queueState.stopped;
    if (queueState !== undefined) {
      queueState.stopped = true;
    }
    clearQueueTimer();
    queueState = undefined;
    if (publish && wasRunning) {
      publishStatus();
    }
  };

  const scheduleQueue = (state: QueueState): void => {
    if (queueState !== state || state.stopped) {
      return;
    }
    state.timeout = setTimeout(() => {
      void runQueueOnce();
    }, state.delayMs);
  };

  const runQueueOnce = async (): Promise<void> => {
    const state = queueState;
    if (state === undefined || state.stopped || state.packets.length === 0) {
      stopQueue();
      return;
    }

    const packet = state.packets[state.index];
    state.index = (state.index + 1) % state.packets.length;
    try {
      await sendPacket({ packet: packet ?? "", target: state.target });
    } catch (cause) {
      console.error("[game:packets] queue send failed", cause);
      stopQueue(false);
      publishStatus("Queue stopped after a send failure");
      return;
    }
    scheduleQueue(state);
  };

  const startQueue = (payload: PacketQueuePayload): void => {
    const normalized = normalizePacketQueuePayload(payload);
    stopQueue(false);
    queueState = {
      delayMs: clampPacketQueueDelay(normalized.delayMs),
      index: 0,
      packets: normalized.packets,
      stopped: false,
      target: normalized.target,
      timeout: undefined,
    };
    void runQueueOnce();
    publishStatus();
  };

  const handleRequest = async (request: PacketsRequest): Promise<void> => {
    try {
      switch (request.kind) {
        case "start-capture":
          await startCapture();
          break;
        case "stop-capture":
          stopCapture();
          break;
        case "send":
          await sendPacket(request.payload);
          break;
        case "start-queue":
          startQueue(request.payload);
          break;
        case "stop-queue":
          stopQueue();
          break;
      }

      await sendResponse({
        ok: true,
        outcome: { kind: request.kind },
        requestId: request.requestId,
      });
    } catch (cause) {
      await sendResponse({
        error: errorMessage(cause),
        ok: false,
        requestId: request.requestId,
      });
    }
  };

  const unsubscribeRequests = packetsBridge.onRequest((request) => {
    requests = requests
      .catch((cause: unknown) => {
        console.error("[game:packets] request queue failed", cause);
      })
      .then(() =>
        disposed
          ? sendResponse({
              error: "The Packets bridge is unavailable.",
              ok: false,
              requestId: request.requestId,
            })
          : handleRequest(request),
      );
    void requests.catch((cause: unknown) => {
      console.error("[game:packets] response failed", cause);
    });
  });

  const stopActive = (stoppedReason?: string): void => {
    const wasRunning =
      captureDispose !== undefined ||
      (queueState !== undefined && !queueState.stopped);
    stopCapture(false);
    stopQueue(false);
    if (wasRunning && stoppedReason !== undefined) {
      publishStatus(stoppedReason);
    }
  };

  void runtime
    .runPromise(
      Effect.gen(function* () {
        const api = yield* Api;
        return yield* api.events.on({ type: "connection" }, (event) =>
          Effect.sync(() => {
            if (
              event.status === "OnConnectionLost" ||
              event.status === "OnConnectionFailed"
            ) {
              stopActive(
                "Packet activity stopped because the game disconnected",
              );
            }
          }),
        );
      }),
    )
    .then((dispose) => {
      if (disposed) {
        dispose();
      } else {
        connectionDispose = dispose;
      }
    })
    .catch((cause: unknown) => {
      console.error("[game:packets] connection subscription failed", cause);
    });

  return {
    dispose: () => {
      disposed = true;
      unsubscribeRequests();
      connectionDispose?.();
      connectionDispose = undefined;
      stopActive();
    },
    stopActive,
  };
};
