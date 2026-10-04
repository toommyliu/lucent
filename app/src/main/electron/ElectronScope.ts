import type { WebContents } from "electron";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Scope from "effect/Scope";

export const observeElectronEvent = <
  const Event extends string,
  Args extends readonly unknown[],
>(
  target: {
    on: (
      event: NoInfer<Event>,
      listener: (...args: NoInfer<Args>) => void,
    ) => unknown;
    removeListener: (
      event: NoInfer<Event>,
      listener: (...args: NoInfer<Args>) => void,
    ) => unknown;
  },
  event: Event,
  listener: (...args: Args) => void,
) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      target.on(event, listener);
    }),
    () =>
      Effect.sync(() => {
        target.removeListener(event, listener);
      }),
  );

export const forkWebContentsScope = Effect.fn("forkWebContentsScope")(
  function* (
    contents: Pick<WebContents, "on" | "removeListener" | "isDestroyed">,
  ) {
    const scope = yield* Scope.fork(yield* Effect.scope);
    const run = Effect.runForkWith(yield* Effect.context());
    yield* observeElectronEvent(contents, "destroyed", () => {
      run(Scope.close(scope, Exit.void).pipe(Effect.uninterruptible));
    }).pipe(Scope.provide(scope));
    if (contents.isDestroyed())
      yield* Scope.close(scope, Exit.void).pipe(Effect.uninterruptible);
    return scope;
  },
);
