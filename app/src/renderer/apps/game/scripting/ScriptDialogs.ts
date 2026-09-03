import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

export interface ScriptDialogSource {
  readonly sourceName: string;
}

interface ScriptDialogRequestBase extends ScriptDialogSource {
  readonly id: number;
  readonly message: string;
}

export interface ScriptAlertRequest extends ScriptDialogRequestBase {
  readonly kind: "alert";
}

export interface ScriptConfirmRequest extends ScriptDialogRequestBase {
  readonly kind: "confirm";
}

export interface ScriptPromptRequest extends ScriptDialogRequestBase {
  readonly defaultValue: string;
  readonly kind: "prompt";
}

export type ScriptDialogRequest =
  | ScriptAlertRequest
  | ScriptConfirmRequest
  | ScriptPromptRequest;

type ScriptDialogRequestInput =
  | Omit<ScriptAlertRequest, "id">
  | Omit<ScriptConfirmRequest, "id">
  | Omit<ScriptPromptRequest, "id">;

export type ScriptDialogResponse =
  | { readonly id: number; readonly kind: "alert" }
  | {
      readonly confirmed: boolean;
      readonly id: number;
      readonly kind: "confirm";
    }
  | {
      readonly id: number;
      readonly kind: "prompt";
      readonly value: string | null;
    };

interface PendingDialog {
  readonly canceled: Deferred.Deferred<void>;
  readonly request: ScriptDialogRequest;
  readonly response: Deferred.Deferred<ScriptDialogResponse>;
}

export interface ScriptDialogsShape {
  readonly alert: (
    source: ScriptDialogSource,
    message: string,
  ) => Effect.Effect<void>;
  readonly confirm: (
    source: ScriptDialogSource,
    message: string,
  ) => Effect.Effect<boolean>;
  readonly getCurrent: () => Effect.Effect<ScriptDialogRequest | null>;
  readonly onCurrent: (
    listener: (request: ScriptDialogRequest | null) => void,
  ) => Effect.Effect<() => void>;
  readonly prompt: (
    source: ScriptDialogSource,
    message: string,
    defaultValue?: string,
  ) => Effect.Effect<string | null>;
  readonly respond: (response: ScriptDialogResponse) => Effect.Effect<boolean>;
}

export class ScriptDialogs extends Context.Service<
  ScriptDialogs,
  ScriptDialogsShape
>()("lucent/game/scripting/ScriptDialogs") {}

const snapshotRequest = (
  request: ScriptDialogRequest,
): ScriptDialogRequest => ({ ...request });

const snapshotCurrent = (
  request: ScriptDialogRequest | null,
): ScriptDialogRequest | null =>
  request === null ? null : snapshotRequest(request);

const responseMatchesRequest = (
  request: ScriptDialogRequest,
  response: ScriptDialogResponse,
): boolean => request.id === response.id && request.kind === response.kind;

const requestWithId = (
  request: ScriptDialogRequestInput,
  id: number,
): ScriptDialogRequest => {
  switch (request.kind) {
    case "alert":
      return { ...request, id };
    case "confirm":
      return { ...request, id };
    case "prompt":
      return { ...request, id };
  }
};

export const makeScriptDialogs = Effect.fnUntraced(function* () {
  const scope = yield* Effect.scope;
  const runFork = Effect.runForkWith(yield* Effect.context<never>());
  const queue = yield* Queue.unbounded<PendingDialog>();
  const activeRef = yield* Ref.make<PendingDialog | null>(null);
  const currentRef = yield* SubscriptionRef.make<ScriptDialogRequest | null>(
    null,
  );
  const nextIdRef = yield* Ref.make(0);

  const clearActive = (pending: PendingDialog) =>
    Effect.gen(function* () {
      const active = yield* Ref.get(activeRef);
      if (active !== pending) return;

      yield* Ref.set(activeRef, null);
      yield* SubscriptionRef.set(currentRef, null);
    });

  const processNext = Effect.fn("ScriptDialogs.processNext")(function* () {
    const pending = yield* Queue.take(queue);
    if (yield* Deferred.isDone(pending.canceled)) return;

    yield* Ref.set(activeRef, pending);
    yield* SubscriptionRef.set(currentRef, snapshotRequest(pending.request));
    yield* Effect.raceFirst(
      Deferred.await(pending.response).pipe(Effect.asVoid),
      Deferred.await(pending.canceled),
    ).pipe(Effect.ensuring(clearActive(pending)));
  });

  yield* Effect.gen(function* () {
    while (true) {
      yield* processNext();
    }
  }).pipe(Effect.forkIn(scope));

  const enqueue = Effect.fn("ScriptDialogs.enqueue")(function* (
    request: ScriptDialogRequestInput,
  ): Effect.fn.Return<ScriptDialogResponse> {
    return yield* Effect.acquireUseRelease(
      Effect.gen(function* () {
        const id = yield* Ref.updateAndGet(nextIdRef, (current) => current + 1);
        const pending: PendingDialog = {
          canceled: yield* Deferred.make<void>(),
          request: requestWithId(request, id),
          response: yield* Deferred.make<ScriptDialogResponse>(),
        };
        yield* Queue.offer(queue, pending);
        return pending;
      }),
      (pending) => Deferred.await(pending.response),
      (pending) =>
        Deferred.succeed(pending.canceled, undefined).pipe(Effect.asVoid),
    );
  });

  const alert: ScriptDialogsShape["alert"] = (source, message) =>
    enqueue({ ...source, kind: "alert", message }).pipe(Effect.asVoid);

  const confirm: ScriptDialogsShape["confirm"] = (source, message) =>
    Effect.gen(function* () {
      const response = yield* enqueue({ ...source, kind: "confirm", message });
      if (response.kind !== "confirm") {
        return yield* Effect.die("Script dialog response kind did not match.");
      }
      return response.confirmed;
    });

  const prompt: ScriptDialogsShape["prompt"] = (
    source,
    message,
    defaultValue = "",
  ) =>
    Effect.gen(function* () {
      const response = yield* enqueue({
        ...source,
        defaultValue,
        kind: "prompt",
        message,
      });
      if (response.kind !== "prompt") {
        return yield* Effect.die("Script dialog response kind did not match.");
      }
      return response.value;
    });

  const respond: ScriptDialogsShape["respond"] = (response) =>
    Effect.gen(function* () {
      const active = yield* Ref.get(activeRef);
      if (
        active === null ||
        !responseMatchesRequest(active.request, response)
      ) {
        return false;
      }
      return yield* Deferred.succeed(active.response, response);
    });

  const onCurrent: ScriptDialogsShape["onCurrent"] = (listener) =>
    SubscriptionRef.changes(currentRef).pipe(
      Stream.runForEach((request) =>
        Effect.sync(() => listener(snapshotCurrent(request))),
      ),
      Effect.forkIn(scope),
      Effect.map((fiber) => () => {
        runFork(Fiber.interrupt(fiber));
      }),
    );

  return ScriptDialogs.of({
    alert,
    confirm,
    getCurrent: () =>
      SubscriptionRef.get(currentRef).pipe(Effect.map(snapshotCurrent)),
    onCurrent,
    prompt,
    respond,
  });
});

export const layer = Layer.effect(ScriptDialogs, makeScriptDialogs());
