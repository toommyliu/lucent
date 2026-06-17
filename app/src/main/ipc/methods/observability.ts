import { Effect, Scope } from "effect";
import { ObservabilityIpcChannels } from "../../../shared/ipc";
import { normalizeObservabilityInput } from "../../../shared/observability";
import { DesktopObservability } from "../../app/DesktopObservability";
import { DesktopIpc } from "../DesktopIpc";

export const registerObservabilityIpcHandlers = (): Effect.Effect<
  void,
  never,
  DesktopIpc | DesktopObservability | Scope.Scope
> =>
  Effect.gen(function* () {
    const ipc = yield* DesktopIpc;

    yield* ipc.handle(ObservabilityIpcChannels.write, (_event, input) =>
      Effect.gen(function* () {
        const observability = yield* DesktopObservability;
        yield* observability.write(normalizeObservabilityInput(input));
      }),
    );

    yield* ipc.handle(ObservabilityIpcChannels.snapshot, () =>
      Effect.gen(function* () {
        const observability = yield* DesktopObservability;
        return yield* observability.snapshot;
      }),
    );
  });
