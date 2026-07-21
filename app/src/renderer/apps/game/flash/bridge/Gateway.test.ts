import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import { makeWait } from "../protocol/Wait";
import { Bridge, makeBridge } from "./Bridge";
import { makeGateway } from "./Gateway";

const swfTarget = {
  swf: {
    "flash.sendClientPacket": () => undefined,
  },
} as unknown as Pick<Window, "swf">;

describe("Gateway", () => {
  it.effect(
    "owns callbacks until disposal and publishes after projection",
    () => {
      const target = {} as Window;
      const projected: string[] = [];

      return Effect.gen(function* () {
        yield* Effect.scoped(
          Effect.gen(function* () {
            const gateway = yield* makeGateway(target);
            yield* gateway.start((packet) =>
              Effect.sync(() => {
                projected.push(packet.command);
              }),
            );
            const wait = makeWait(gateway);
            const packet = yield* wait.forPacket(
              { command: "moveToCell", direction: "client" },
              {
                timeout: "1 second",
                trigger: Effect.sync(() => {
                  target.packetFromClient?.(
                    "%xt%zm%moveToCell%1%battleon-1%Enter%Spawn%",
                  );
                }).pipe(Effect.as(true)),
              },
            );

            expect(packet?.command).toBe("moveToCell");
            expect(projected).toEqual(["moveToCell"]);
            expect(target.packetFromClient).toBeTypeOf("function");
          }),
        );

        expect(target.packetFromClient).toBeUndefined();
      }).pipe(Effect.provide(Layer.effect(Bridge, makeBridge(swfTarget))));
    },
  );
});
