import type { WebContents } from "electron";
import { Effect, Scope } from "effect";
import { ObservabilityIpcChannels } from "../../../shared/ipc";
import {
  normalizeObservabilityInput,
  type ObservabilityInput,
} from "../../../shared/observability";
import { DesktopObservability } from "../../app/DesktopObservability";
import { DesktopIpc } from "../DesktopIpc";
import { getSenderWindowId } from "../DesktopIpcRequest";

const normalizeRendererObservabilityInput = (
  sender: WebContents,
  input: unknown,
): ObservabilityInput => {
  const normalized = normalizeObservabilityInput(input);
  if (normalized.source !== "game" || normalized.component !== "game-window") {
    return normalized;
  }

  const senderWindowId = getSenderWindowId(sender);
  return senderWindowId === undefined
    ? normalized
    : {
        ...normalized,
        component: `game-window:${senderWindowId}`,
      };
};

export const registerObservabilityIpcHandlers = (): Effect.Effect<
  void,
  never,
  DesktopIpc | DesktopObservability | Scope.Scope
> =>
  Effect.gen(function* () {
    const ipc = yield* DesktopIpc;

    yield* ipc.handle(ObservabilityIpcChannels.write, (event, input) =>
      Effect.gen(function* () {
        const observability = yield* DesktopObservability;
        yield* observability.write(
          normalizeRendererObservabilityInput(event.sender, input),
        );
      }),
    );

    yield* ipc.handle(ObservabilityIpcChannels.snapshot, () =>
      Effect.gen(function* () {
        const observability = yield* DesktopObservability;
        return yield* observability.snapshot;
      }),
    );
  });
