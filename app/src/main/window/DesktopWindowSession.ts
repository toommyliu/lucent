import type {
  RenderProcessGoneDetails,
  Event as ElectronEvent,
} from "electron";
import * as Effect from "effect/Effect";
import * as Cause from "effect/Cause";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FiberSet from "effect/FiberSet";
import * as Scope from "effect/Scope";

import { makeListenerRegistry } from "../app/ListenerRegistry";
import { observeElectronEvent } from "../electron/ElectronScope";
import {
  isElectronWindowUsable,
  type ElectronNativeWindowHandle,
  type ElectronWindowWebContents,
} from "../electron/ElectronWindow";
import type { DesktopWindowKind } from "./DesktopWindowCatalog";
import { DesktopWindowError } from "./DesktopWindowError";
import type {
  DesktopWindowClosedEvent,
  DesktopWindowCreatedEvent,
  DesktopWindowRendererDestroyedEvent,
  DesktopWindowRendererUnavailableEvent,
  DesktopWindowRendererReloadedEvent,
  DesktopWindowRendererReadyEvent,
} from "./DesktopWindows";
import {
  observeWindowReloads,
  INITIAL_WINDOW_GENERATION,
} from "./WindowGeneration";

export type RendererState =
  | {
      readonly phase: "preparing" | "loading" | "ready";
      readonly generation: number;
    }
  | {
      readonly phase: "error";
      readonly generation: number;
      readonly error: string;
      readonly unavailable: boolean;
    };

export interface DesktopWindowSession {
  readonly id: string;
  readonly kind: DesktopWindowKind;
  readonly ownerId: string | undefined;
  readonly rendererId: number;
  readonly contents: ElectronWindowWebContents;
  readonly window: ElectronNativeWindowHandle;
  readonly scope: Scope.Closeable;
  readonly rendererScope: Scope.Closeable;
  readonly state: RendererState;
  readonly name: string | undefined;
  readonly username: string | undefined;
  readonly close: Effect.Effect<void>;
  readonly setName: (name: string) => void;
  readonly loadFailed: (message: string) => void;
  readonly markReady: (
    generation: number,
  ) => Effect.Effect<void, DesktopWindowError>;
}

const normalizeGameViewName = (
  value: string | undefined,
): string | undefined => {
  const name = value?.trim();
  return name === undefined || name === "" ? undefined : name.slice(0, 64);
};

const usable = (session: DesktopWindowSession) =>
  session.scope.state._tag !== "Closed" &&
  isElectronWindowUsable(session.window) &&
  !session.contents.isDestroyed();

export const awaitWindowCreation = Effect.fn("awaitWindowCreation")(function* <
  A,
  E,
>(
  id: string,
  fiber: Fiber.Fiber<A, E>,
): Effect.fn.Return<A, E | DesktopWindowError> {
  const exit = yield* Fiber.await(fiber);
  if (Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause))
    return yield* new DesktopWindowError({
      id,
      detail: "The window closed during creation.",
    });
  return yield* exit;
});

export const makeDesktopWindowSessions = Effect.gen(function* () {
  const parent = yield* Effect.scope;
  const run = yield* FiberSet.makeRuntime<never, void>();
  const byId = new Map<string, DesktopWindowSession>();
  const byRendererId = new Map<number, DesktopWindowSession>();
  const created = makeListenerRegistry<DesktopWindowCreatedEvent>();
  const closed = makeListenerRegistry<DesktopWindowClosedEvent>({
    concurrency: "unbounded",
  });
  const destroyed = makeListenerRegistry<DesktopWindowRendererDestroyedEvent>({
    concurrency: "unbounded",
  });
  const unavailable =
    makeListenerRegistry<DesktopWindowRendererUnavailableEvent>({
      concurrency: "unbounded",
    });
  const reloaded = makeListenerRegistry<DesktopWindowRendererReloadedEvent>({
    concurrency: "unbounded",
  });
  const ready = makeListenerRegistry<DesktopWindowRendererReadyEvent>();

  const open = Effect.fn("DesktopWindowSessions.open")(function* <
    Native extends {
      readonly window: ElectronNativeWindowHandle;
      readonly contents: ElectronWindowWebContents;
    },
  >(options: {
    readonly id: string;
    readonly kind: DesktopWindowKind;
    readonly ownerId?: string;
    readonly name?: string;
    readonly parentScope?: Scope.Scope;
    readonly acquire: Effect.Effect<Native, unknown, Scope.Scope>;
    readonly setup?: (
      session: DesktopWindowSession & Native,
    ) => Effect.Effect<void, unknown, Scope.Scope>;
    readonly onChanged: (session: DesktopWindowSession) => void;
    readonly onClosed: (session: DesktopWindowSession) => void;
    readonly onCreated?: (
      event: DesktopWindowCreatedEvent,
    ) => Effect.Effect<void, unknown>;
  }) {
    const scope = yield* Scope.fork(options.parentScope ?? parent);
    const isClosed = () => scope.state._tag === "Closed";
    if (isClosed())
      return yield* Effect.fail(
        new DesktopWindowError({
          id: options.id,
          detail: "The owning window is closed.",
        }),
      );
    return yield* Effect.gen(function* () {
      let session: DesktopWindowSession | undefined;
      yield* Effect.addFinalizer(() =>
        Effect.gen(function* () {
          const current = session;
          if (current === undefined) return;
          yield* Effect.sync(() => options.onClosed(current)).pipe(
            Effect.catchCause(Effect.logError),
          );
          run(
            closed.publish({
              id: current.id,
              kind: current.kind,
              rendererId: current.rendererId,
            }),
          );
        }),
      );
      const rendererScope = yield* Scope.fork(scope);
      const native = yield* options.acquire;
      if (isClosed())
        return yield* Effect.fail(
          new DesktopWindowError({
            id: options.id,
            detail: "The window closed during creation.",
          }),
        );
      let state: RendererState = {
        phase: "preparing",
        generation: INITIAL_WINDOW_GENERATION,
      };
      let name = normalizeGameViewName(options.name);
      let username: string | undefined;
      const update = (next: RendererState): void => {
        if (
          state.phase === next.phase &&
          state.generation === next.generation &&
          (state.phase !== "error" ||
            (next.phase === "error" &&
              state.error === next.error &&
              state.unavailable === next.unavailable))
        )
          return;
        state = next;
        options.onChanged(record);
      };
      const record: DesktopWindowSession & Native = {
        ...native,
        id: options.id,
        kind: options.kind,
        ownerId: options.ownerId,
        rendererId: native.contents.id,
        scope,
        rendererScope,
        get state() {
          return state;
        },
        get name() {
          return name;
        },
        get username() {
          return username;
        },
        close: Scope.close(scope, Exit.void).pipe(
          Effect.tapCause((cause) =>
            Effect.logWarning("Failed to clean up desktop renderer", cause),
          ),
          Effect.uninterruptible,
        ),
        setName: (value) => {
          const next = normalizeGameViewName(value);
          if (name === next && username === next) return;
          name = next;
          username = next;
          options.onChanged(record);
        },
        loadFailed: (error) =>
          update({
            phase: "error",
            generation: state.generation,
            error,
            unavailable: state.phase === "error" && state.unavailable,
          }),
        markReady: (generation) =>
          Effect.suspend(() => {
            if (
              generation !== state.generation ||
              (state.phase === "error" && state.unavailable) ||
              !usable(record)
            ) {
              return Effect.fail(
                new DesktopWindowError({
                  id: record.id,
                  detail: `Renderer generation ${generation} is unavailable.`,
                }),
              );
            }
            if (state.phase === "ready") return Effect.void;
            update({ phase: "ready", generation });
            return ready.publish({
              id: record.id,
              kind: record.kind,
              rendererId: record.rendererId,
              generation,
            });
          }),
      };
      session = record;
      byId.set(record.id, record);
      byRendererId.set(record.rendererId, record);
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          byId.delete(record.id);
          byRendererId.delete(record.rendererId);
        }),
      );
      const identity = {
        id: record.id,
        kind: record.kind,
        rendererId: record.rendererId,
      };
      const contents = record.contents;
      yield* Effect.gen(function* () {
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            run(destroyed.publish(identity));
          }),
        );
        yield* observeElectronEvent(contents, "destroyed", () => {
          state = {
            phase: "error",
            generation: state.generation,
            error: "The game closed.",
            unavailable: true,
          };
          run(
            Scope.close(rendererScope, Exit.void).pipe(Effect.uninterruptible),
          );
        });
        yield* observeElectronEvent(
          contents,
          "render-process-gone",
          (_event: ElectronEvent, details: RenderProcessGoneDetails) => {
            update({
              phase: "error",
              generation: state.generation,
              error: "The game stopped unexpectedly.",
              unavailable: true,
            });
            run(
              unavailable.publish({
                ...identity,
                failure: {
                  type: "render-process-gone",
                  reason: details.reason,
                },
              }),
            );
          },
        );
        yield* Effect.acquireRelease(
          Effect.sync(() =>
            observeWindowReloads(contents, (generation) => {
              update({ phase: "loading", generation });
              run(reloaded.publish({ ...identity, generation }));
            }),
          ),
          (stop) => Effect.sync(stop),
        );
        yield* observeElectronEvent(contents, "did-start-loading", () => {
          if (
            state.phase !== "ready" &&
            (state.phase !== "error" || !state.unavailable)
          )
            update({ phase: "loading", generation: state.generation });
        });
        yield* observeElectronEvent(
          contents,
          "did-fail-load",
          (
            _event: ElectronEvent,
            _code: number,
            message: string,
            _url: string,
            isMainFrame: boolean,
            _processId: number,
            _routingId: number,
          ) => {
            if (isMainFrame) record.loadFailed(message);
          },
        );
      }).pipe(Scope.provide(rendererScope));
      if (options.setup !== undefined) yield* options.setup(record);
      const event = {
        id: record.id,
        kind: record.kind,
        rendererId: record.rendererId,
        generation: state.generation,
      };
      yield* created.publish(event);
      if (options.onCreated !== undefined) yield* options.onCreated(event);
      if (isClosed())
        return yield* Effect.fail(
          new DesktopWindowError({
            id: options.id,
            detail: "The window closed during creation.",
          }),
        );
      return record;
    }).pipe(
      Scope.provide(scope),
      Effect.forkIn(scope, { startImmediately: true }),
      Effect.flatMap((fiber) => awaitWindowCreation(options.id, fiber)),
      Effect.onError((cause) =>
        Scope.close(scope, Exit.failCause(cause)).pipe(Effect.uninterruptible),
      ),
      Effect.mapError((cause) =>
        cause instanceof DesktopWindowError
          ? cause
          : new DesktopWindowError({
              id: options.id,
              detail: "Failed to create desktop renderer.",
              cause,
            }),
      ),
    );
  });

  return {
    open,
    find: (rendererId: number) => {
      const session = byRendererId.get(rendererId);
      return session !== undefined && usable(session) ? session : undefined;
    },
    get: (id: string) => {
      const session = byId.get(id);
      return session !== undefined && usable(session) ? session : undefined;
    },
    values: () => byId.values(),
    created,
    closed,
    destroyed,
    unavailable,
    reloaded,
    ready,
  };
});

export type DesktopWindowSessions = Effect.Success<
  typeof makeDesktopWindowSessions
>;
