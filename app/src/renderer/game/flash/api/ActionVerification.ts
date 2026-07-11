import { Deferred, Effect, Option } from "effect";

import type { FlashPacket, PacketSelector, WaitOptions } from "../Types";
import type { FlashProtocolShape } from "../protocol/FlashProtocol";

export interface PacketActionResult<A> {
  readonly actionResult: A;
  readonly packet: FlashPacket | null;
}

export interface PacketObservationOptions<A> extends Pick<
  WaitOptions,
  "timeout"
> {
  readonly shouldAwait?: (actionResult: A) => boolean;
}

/**
 * Runs an action while watching for its corresponding response packet.
 *
 * The listener is registered before the action is dispatched, so an immediate
 * response cannot be missed. Returns the action's result plus the first packet
 * accepted by `matches`, or `null` when no matching packet arrives before the
 * timeout. `shouldAwait` may skip the response wait for a given action result.
 */
export const observePacketDuring = <A, E, R>(
  protocol: Pick<FlashProtocolShape, "onPacket">,
  selector: PacketSelector,
  matches: (packet: FlashPacket) => boolean,
  action: Effect.Effect<A, E, R>,
  options?: PacketObservationOptions<A>,
): Effect.Effect<PacketActionResult<A>, E, R> =>
  Effect.gen(function* () {
    const deferred = yield* Deferred.make<FlashPacket>();
    return yield* Effect.acquireUseRelease(
      protocol.onPacket(selector, (packet) =>
        matches(packet)
          ? Deferred.succeed(deferred, packet).pipe(Effect.asVoid)
          : Effect.void,
      ),
      () =>
        Effect.gen(function* () {
          const actionResult = yield* action;
          if (options?.shouldAwait?.(actionResult) === false) {
            return { actionResult, packet: null };
          }

          const observed = yield* Deferred.await(deferred).pipe(
            Effect.timeoutOption(options?.timeout ?? "5 seconds"),
          );
          return {
            actionResult,
            packet: Option.isSome(observed) ? observed.value : null,
          };
        }),
      (dispose) => Effect.sync(dispose),
    );
  });
