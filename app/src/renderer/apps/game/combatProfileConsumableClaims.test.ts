import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { makeCombatProfileConsumableClaims } from "./combatProfileConsumableClaims";

describe("CombatProfileConsumableClaims", () => {
  it.effect(
    "keeps the first item claimed until every compatible runner stops",
    () =>
      Effect.gen(function* () {
        const claims = makeCombatProfileConsumableClaims();
        const first = yield* claims.acquire(100);
        const shared = yield* claims.acquire(100);
        const conflicting = yield* claims.acquire(200);

        expect(first).toMatchObject({ acquired: true, first: true });
        expect(shared).toMatchObject({ acquired: true, first: false });
        expect(conflicting).toMatchObject({ acquired: false, first: false });

        yield* first.release;
        expect(yield* claims.acquire(200)).toMatchObject({ acquired: false });

        yield* shared.release;
        const next = yield* claims.acquire(200);
        expect(next).toMatchObject({ acquired: true, first: true });

        yield* first.release;
        expect(yield* claims.acquire(100)).toMatchObject({ acquired: false });
      }),
  );

  it.effect("lets an ambient skill 5 profile reserve preflight equipment", () =>
    Effect.gen(function* () {
      const claims = makeCombatProfileConsumableClaims();
      const ambient = yield* claims.acquire(undefined);
      const sharedAmbient = yield* claims.acquire(undefined);

      expect(ambient).toMatchObject({ acquired: true, first: true });
      expect(sharedAmbient).toMatchObject({ acquired: true, first: false });
      expect(yield* claims.acquire(100)).toMatchObject({ acquired: false });

      yield* ambient.release;
      yield* sharedAmbient.release;
      expect(yield* claims.acquire(100)).toMatchObject({
        acquired: true,
        first: true,
      });
    }),
  );
});
