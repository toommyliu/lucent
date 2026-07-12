import { Effect, Option, Schema } from "effect";
import type { Duration } from "effect";

import type { BridgeService } from "../bridge/Bridge";
import type { GatewayService } from "../bridge/Gateway";
import type { GameAction } from "../contract/GameAction";
import type { WaitOptions } from "../contract/Packet";
import { makeWait } from "../protocol/Wait";

const isWaitOptions = (
  options: WaitOptions | Duration.Input,
): options is WaitOptions =>
  typeof options === "object" &&
  !Array.isArray(options) &&
  ("timeout" in options || "interval" in options);

export const makeWaitApi = (bridge: BridgeService, gateway: GatewayService) => {
  // A triggered wait acquires its event/packet subscription before running the
  // command Effect. The command returns true only when a response is expected,
  // which prevents both synchronous-response races and pointless timeouts after
  // a command failed to send.
  const wait = makeWait(gateway);
  const isGameActionAvailable = (action: GameAction) =>
    bridge
      .invoke("world.isActionAvailable", [action], Schema.Boolean)
      .pipe(Effect.map(Option.getOrElse(() => false)));

  const forGameAction = (
    action: GameAction,
    options?: WaitOptions | Duration.Input,
  ) => {
    const normalized: WaitOptions =
      options === undefined
        ? {}
        : isWaitOptions(options)
          ? options
          : { timeout: options };
    return wait.until(isGameActionAvailable(action), {
      ...normalized,
      timeout: normalized.timeout ?? "2 seconds",
    });
  };

  return {
    ...wait,
    forGameAction,
    isGameActionAvailable,
  };
};

export type Wait = ReturnType<typeof makeWaitApi>;
