import { Cause, Effect } from "effect";

import { ScriptExecutionError } from "../ScriptRunnerErrors";

export type ScriptGenerator<A = unknown> = Generator<
  Effect.Effect<any, any, never>,
  A,
  any
>;

export type ScriptCallbackResult<A = unknown> =
  | Effect.Effect<A, unknown>
  | ScriptGenerator<A>;

const isGenerator = (value: unknown): value is Generator =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { readonly next?: unknown }).next === "function" &&
  typeof (value as { readonly throw?: unknown }).throw === "function";

export const normalizeScriptCallbackResult = (
  result: unknown,
): Effect.Effect<unknown, unknown> => {
  if (Effect.isEffect(result)) {
    return result as Effect.Effect<unknown, unknown>;
  }

  if (isGenerator(result)) {
    return Effect.gen(function* () {
      const iterator = result as Generator<
        Effect.Effect<any, any, never>,
        unknown,
        any
      >;
      return yield* iterator;
    });
  }

  return Effect.fail(
    new ScriptExecutionError({
      detail:
        "Script callbacks must return an Effect or generator; plain values and Promises are not supported.",
    }),
  );
};

export const normalizeScriptCallback = <A>(
  callback: (value: A) => ScriptCallbackResult | unknown,
  value: A,
): Effect.Effect<void, unknown> =>
  Effect.try({
    try: () => callback(value),
    catch: (cause) =>
      new ScriptExecutionError({
        detail: "Script callback threw before returning an Effect.",
        cause,
      }),
  }).pipe(Effect.flatMap(normalizeScriptCallbackResult), Effect.asVoid);

export const notifyScriptCallbackFailure =
  <A>(
    callback: (value: A) => ScriptCallbackResult | unknown,
    failCause: (cause: Cause.Cause<unknown>) => Effect.Effect<void>,
  ): ((value: A) => Effect.Effect<void, unknown>) =>
  (value) =>
    normalizeScriptCallback(callback, value).pipe(
      Effect.catchCause((cause) =>
        failCause(cause).pipe(Effect.andThen(Effect.failCause(cause))),
      ),
    );
