import { describe, expect, it } from "@effect/vitest";
import { Effect, Fiber, FiberMap, Ref, Result } from "effect";
import * as TestClock from "effect/testing/TestClock";

import type { ApiService } from "../flash/api/Api";
import { makeAutoRelogin } from "./AutoRelogin";

describe("AutoRelogin", () => {
  it.effect("stops after the bounded connection retry budget", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const attempts = yield* Ref.make(0);
        const fibers = yield* FiberMap.make<string>();
        const api = {
          auth: {
            connectTo: () =>
              Ref.update(attempts, (count) => count + 1).pipe(
                Effect.as({
                  message: "Server is full",
                  retryable: true,
                  status: "full" as const,
                }),
              ),
          },
        } as unknown as ApiService;
        const autoRelogin = yield* makeAutoRelogin(api, fibers);
        const resultFiber = yield* Effect.result(
          autoRelogin.runLogin({
            password: "secret",
            server: "Server",
            username: "Hero",
          }),
        ).pipe(Effect.forkScoped);

        yield* TestClock.adjust("3 seconds");
        const result = yield* Fiber.join(resultFiber);

        expect(Result.isFailure(result)).toBe(true);
        expect(yield* Ref.get(attempts)).toBe(3);
      }),
    ).pipe(Effect.provide(TestClock.layer())),
  );
});
