import * as Effect from "effect/Effect";
import * as Semaphore from "effect/Semaphore";

interface CombatProfileConsumableClaim {
  /** Whether this runner joined the current compatible claim. */
  readonly acquired: boolean;
  /** Whether this runner claimed the preflight equip capability. */
  readonly first: boolean;
  /** Releases this runner's compatible claim, if one was acquired. */
  readonly release: Effect.Effect<void>;
}

interface ClaimState {
  readonly holders: number;
  readonly itemId: number | undefined;
}

/** Coordinates preflight equipment without restricting combat-profile runners. */
export const makeCombatProfileConsumableClaims = () => {
  const semaphore = Semaphore.makeUnsafe(1);
  let state: ClaimState | undefined;

  const acquire = Effect.fn("CombatProfileConsumableClaims.acquire")(function* (
    itemId: number | undefined,
  ): Effect.fn.Return<CombatProfileConsumableClaim> {
    return yield* semaphore.withPermit(
      Effect.sync(() => {
        if (state !== undefined && state.itemId !== itemId) {
          return {
            acquired: false,
            first: false,
            release: Effect.void,
          };
        }

        const first = state === undefined;
        state = {
          holders: (state?.holders ?? 0) + 1,
          itemId,
        };
        let released = false;

        return {
          acquired: true,
          first,
          release: semaphore.withPermit(
            Effect.sync(() => {
              if (released) return;
              released = true;

              if (state === undefined || state.itemId !== itemId) return;
              state =
                state.holders === 1
                  ? undefined
                  : { ...state, holders: state.holders - 1 };
            }),
          ),
        };
      }),
    );
  });

  return { acquire };
};
