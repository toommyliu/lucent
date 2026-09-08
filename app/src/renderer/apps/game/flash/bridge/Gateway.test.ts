import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

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
            const projecting = yield* Deferred.make<void>();
            const release = yield* Deferred.make<void>();
            yield* gateway.start((packet) =>
              Effect.sync(() => {
                projected.push(packet.command);
              }).pipe(
                Effect.andThen(Deferred.succeed(projecting, undefined)),
                Effect.andThen(Deferred.await(release)),
              ),
            );
            const wait = makeWait(gateway);
            const waiting = yield* wait
              .forPacket(
                { command: "moveToCell", direction: "client" },
                {
                  timeout: "1 second",
                  trigger: Effect.sync(() => {
                    target.packetFromClient?.(
                      "%xt%zm%moveToCell%1%battleon-1%Enter%Spawn%",
                    );
                  }).pipe(Effect.as(true)),
                },
              )
              .pipe(Effect.forkScoped);

            yield* Deferred.await(projecting);
            yield* Effect.yieldNow;
            expect(waiting.pollUnsafe()).toBeUndefined();
            yield* Deferred.succeed(release, undefined);
            const packet = yield* Fiber.join(waiting);
            expect(packet?.command).toBe("moveToCell");
            expect(projected).toEqual(["moveToCell"]);
            expect(target.packetFromClient).toBeTypeOf("function");
          }),
        );

        expect(target.packetFromClient).toBeUndefined();
      }).pipe(Effect.provide(Layer.effect(Bridge, makeBridge(swfTarget))));
    },
  );

  it.effect(
    "publishes raw packets even when their envelope is unsupported",
    () => {
      const target = {} as Window;

      return Effect.scoped(
        Effect.gen(function* () {
          const gateway = yield* makeGateway(target);
          yield* gateway.start(() => Effect.void);
          const capture = yield* gateway.rawPackets.pipe(
            Stream.runHead,
            Effect.forkScoped,
          );
          yield* Effect.yieldNow;

          target.packetFromClient?.("<msg t='sys'></msg>");

          expect(Option.getOrNull(yield* Fiber.join(capture))).toEqual({
            direction: "client",
            raw: "<msg t='sys'></msg>",
          });
        }),
      ).pipe(Effect.provide(Layer.effect(Bridge, makeBridge(swfTarget))));
    },
  );
});
