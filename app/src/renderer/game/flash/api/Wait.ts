import { Effect, Option, Schema } from "effect";
import type { Duration } from "effect";

import type { BridgeService } from "../bridge/Bridge";
import type { GatewayService } from "../bridge/Gateway";
import type { WaitOptions } from "../contract/Packet";
import { makeWait } from "../protocol/Wait";

const isWaitOptions = (
  options: WaitOptions | Duration.Input,
): options is WaitOptions =>
  typeof options === "object" &&
  !Array.isArray(options) &&
  ("timeout" in options || "interval" in options);

export const makeWaitApi = (bridge: BridgeService, gateway: GatewayService) => {
  const wait = makeWait(gateway);
  const isGameActionAvailable = (action: string) =>
    bridge
      .invoke("world.isActionAvailable", [action], Schema.Boolean)
      .pipe(Effect.map(Option.getOrElse(() => false)));

  const forGameAction = (
    action: string,
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
