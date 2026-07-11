import {
  Context,
  Data,
  Effect,
  Layer,
  Option,
  PubSub,
  Schema,
  Stream,
} from "effect";

import type { Diagnostic } from "../contract/Diagnostic";
import { makeDiagnostic } from "../contract/Diagnostic";

type Method = keyof Window["swf"];

class InvokeFailure extends Data.TaggedError("InvokeFailure")<{
  readonly cause: unknown;
}> {}

export const makeBridge = (target?: Pick<Window, "swf">) =>
  Effect.gen(function* () {
    const resolvedTarget = target ?? window;
    const diagnostics = yield* PubSub.unbounded<Diagnostic>();
    yield* Effect.addFinalizer(() => PubSub.shutdown(diagnostics));

    const fail = (method: Method, cause: unknown) =>
      PubSub.publish(
        diagnostics,
        makeDiagnostic("invoke", String(method), cause),
      ).pipe(Effect.as(Option.none()));

    const invoke = <A>(
      method: Method,
      args: readonly unknown[] | undefined,
      schema: Schema.Decoder<A>,
    ): Effect.Effect<Option.Option<A>> =>
      Effect.try({
        try: () => {
          const candidate: unknown = resolvedTarget.swf[method];
          if (typeof candidate !== "function") {
            throw new Error(`Missing Flash method: ${String(method)}`);
          }
          return candidate(...(args ?? []));
        },
        catch: (cause) => new InvokeFailure({ cause }),
      }).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(schema)),
        Effect.map(Option.some),
        Effect.catch((cause) => fail(method, cause)),
      );

    const invokeJson = <A>(
      method: Method,
      args: readonly unknown[] | undefined,
      schema: Schema.Decoder<A>,
    ): Effect.Effect<Option.Option<A>> =>
      invoke(method, args, Schema.Union([Schema.String, Schema.Unknown])).pipe(
        Effect.flatMap(
          Option.match({
            onNone: () => Effect.succeed(Option.none<A>()),
            onSome: (value) => {
              if (typeof value !== "string") {
                return Schema.decodeUnknownEffect(schema)(value).pipe(
                  Effect.map(Option.some),
                  Effect.catch((cause) => fail(method, cause)),
                );
              }

              return Effect.try({
                try: () => JSON.parse(value) as unknown,
                catch: (cause) => new InvokeFailure({ cause }),
              }).pipe(
                Effect.flatMap(Schema.decodeUnknownEffect(schema)),
                Effect.map(Option.some),
                Effect.catch((cause) => fail(method, cause)),
              );
            },
          }),
        ),
      );

    return {
      diagnostics: Stream.fromPubSub(diagnostics),
      invoke,
      invokeJson,
    };
  });

export class Bridge extends Context.Service<Bridge>()(
  "lucent/renderer/flash/Bridge",
  { make: makeBridge() },
) {}

export const layer = Layer.effect(Bridge, Bridge.make);
