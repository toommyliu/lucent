import { Effect, Layer, Schema, Scope } from "effect";
import { beforeEach, describe, expect, it } from "@effect/vitest";
import { vi } from "vitest";
import {
  DesktopObservability,
  type DesktopObservabilityShape,
} from "../app/DesktopObservability";
import {
  args1,
  defineDesktopIpcInvokeContract,
  defineIpcInvokeContract,
  voidReturn,
} from "../../shared/ipc-contract";
import { DesktopIpc, DesktopIpcLive, type DesktopIpcShape } from "./DesktopIpc";

const electronMock = vi.hoisted(() => {
  const handlers = new Map<string, (...args: readonly unknown[]) => unknown>();
  const listeners = new Map<string, (...args: readonly unknown[]) => void>();

  return {
    handlers,
    listeners,
    ipcMain: {
      handle: vi.fn(
        (
          channel: string,
          handler: (...args: readonly unknown[]) => unknown,
        ) => {
          handlers.set(channel, handler);
        },
      ),
      removeHandler: vi.fn((channel: string) => {
        handlers.delete(channel);
      }),
      on: vi.fn(
        (channel: string, listener: (...args: readonly unknown[]) => void) => {
          listeners.set(channel, listener);
        },
      ),
      removeListener: vi.fn(
        (channel: string, listener: (...args: readonly unknown[]) => void) => {
          if (listeners.get(channel) === listener) {
            listeners.delete(channel);
          }
        },
      ),
    },
  };
});

vi.mock("electron", () => ({
  ipcMain: electronMock.ipcMain,
}));

const records: unknown[] = [];

const makeObservability = (): DesktopObservabilityShape => {
  const write: DesktopObservabilityShape["write"] = (input) =>
    Effect.sync(() => {
      records.push(input);
      return {
        id: records.length,
        runId: "test",
        timestamp: "2026-05-22T00:00:00.000Z",
        level: input.level ?? "info",
        source: input.source ?? "main",
        component: input.component ?? "test",
        message: input.message,
      };
    });

  return {
    runId: "test",
    logPath: "/tmp/lucent-test.ndjson",
    write,
    debug: (component, message, data) =>
      write({ level: "debug", source: "main", component, message, data }),
    info: (component, message, data) =>
      write({ level: "info", source: "main", component, message, data }),
    warn: (component, message, data) =>
      write({ level: "warn", source: "main", component, message, data }),
    error: (component, message, error, data) =>
      write({
        level: "error",
        source: "main",
        component,
        message,
        error,
        data,
      }),
    snapshot: Effect.succeed({
      runId: "test",
      logPath: "/tmp/lucent-test.ndjson",
      records: [],
    }),
    subscribe: () => Effect.succeed(() => undefined),
    installProcessHooks: Effect.void,
    observeWindow: () => Effect.void,
  };
};

const withDesktopIpc = <A>(
  body: (
    ipc: DesktopIpcShape,
  ) => Effect.Effect<A, unknown, DesktopIpc | Scope.Scope>,
): Effect.Effect<A, unknown> =>
  Effect.scoped(
    Effect.gen(function* () {
      const ipc = yield* DesktopIpc;
      return yield* body(ipc);
    }),
  ).pipe(
    Effect.provide(
      DesktopIpcLive.pipe(
        Layer.provide(Layer.succeed(DesktopObservability)(makeObservability())),
      ),
    ),
  );

describe("DesktopIpc", () => {
  beforeEach(() => {
    records.length = 0;
    electronMock.handlers.clear();
    electronMock.listeners.clear();
    electronMock.ipcMain.handle.mockClear();
    electronMock.ipcMain.removeHandler.mockClear();
    electronMock.ipcMain.on.mockClear();
    electronMock.ipcMain.removeListener.mockClear();
  });

  it.effect("registers scoped handlers and removes them on scope close", () =>
    Effect.gen(function* () {
      yield* withDesktopIpc((ipc) =>
        Effect.gen(function* () {
          yield* ipc.handle("test:handle", () => Effect.succeed("ok"));

          expect(electronMock.ipcMain.handle).toHaveBeenCalledWith(
            "test:handle",
            expect.any(Function),
          );
          expect(electronMock.handlers.has("test:handle")).toBe(true);
        }),
      );

      expect(electronMock.ipcMain.removeHandler).toHaveBeenCalledWith(
        "test:handle",
      );
      expect(electronMock.handlers.has("test:handle")).toBe(false);
    }),
  );

  it.effect(
    "preserves handler services and records successful invocations",
    () =>
      Effect.gen(function* () {
        yield* withDesktopIpc((ipc) =>
          Effect.gen(function* () {
            yield* ipc.handle("test:ok", (_event, value) =>
              Effect.succeed({ value }),
            );
            const handler = electronMock.handlers.get("test:ok");
            if (handler === undefined) {
              throw new Error("missing handler");
            }

            const result = yield* Effect.promise(
              () => handler({ sender: { id: 7 } }, "value") as Promise<unknown>,
            );

            expect(result).toEqual({ value: "value" });
            expect(records).toEqual(
              expect.arrayContaining([
                expect.objectContaining({
                  level: "debug",
                  component: "ipc",
                  message: "IPC handler completed",
                  data: expect.objectContaining({
                    channel: "test:ok",
                    senderId: 7,
                  }),
                }),
              ]),
            );
          }),
        );
      }),
  );

  it.effect("logs handler failures before rethrowing to Electron", () =>
    Effect.gen(function* () {
      yield* withDesktopIpc((ipc) =>
        Effect.gen(function* () {
          yield* ipc.handle("test:fail", () =>
            Effect.fail(new Error("handler failed")),
          );
          const handler = electronMock.handlers.get("test:fail");
          if (handler === undefined) {
            throw new Error("missing handler");
          }

          yield* Effect.promise(async () => {
            await expect(
              handler({ sender: { id: 9 } }) as Promise<unknown>,
            ).rejects.toThrow("handler failed");
          });

          expect(records).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                level: "error",
                component: "ipc",
                message: "IPC handler failed",
                data: expect.objectContaining({
                  channel: "test:fail",
                  senderId: 9,
                }),
              }),
            ]),
          );
        }),
      );
    }),
  );

  it.effect("rejects invalid contract args before running the handler", () =>
    Effect.gen(function* () {
      yield* withDesktopIpc((ipc) =>
        Effect.gen(function* () {
          const handlerRun = vi.fn();
          yield* ipc.handleContract(
            defineIpcInvokeContract<[string], void>({
              channel: "test:contract-args",
              parseArgs: args1((value) => {
                if (typeof value !== "string") {
                  throw new Error("Expected string");
                }

                return value;
              }),
              parseReturn: voidReturn,
            }),
            (_event, _value) =>
              Effect.sync(() => {
                handlerRun();
              }),
          );
          const handler = electronMock.handlers.get("test:contract-args");
          if (handler === undefined) {
            throw new Error("missing handler");
          }

          yield* Effect.promise(async () => {
            await expect(
              handler({ sender: { id: 10 } }, 1) as Promise<unknown>,
            ).rejects.toThrow("test:contract-args argument 0: Expected string");
          });
          expect(handlerRun).not.toHaveBeenCalled();
        }),
      );
    }),
  );

  it.effect(
    "parses contract handler return values before returning to Electron",
    () =>
      Effect.gen(function* () {
        yield* withDesktopIpc((ipc) =>
          Effect.gen(function* () {
            yield* ipc.handleContract(
              defineIpcInvokeContract<[string], string>({
                channel: "test:contract-return",
                parseArgs: args1((value) => String(value)),
                parseReturn: (value) => {
                  if (typeof value !== "string") {
                    throw new Error("Expected string result");
                  }

                  return value.toUpperCase();
                },
              }),
              (_event, value) => Effect.succeed(value),
            );
            const handler = electronMock.handlers.get("test:contract-return");
            if (handler === undefined) {
              throw new Error("missing handler");
            }

            const result = yield* Effect.promise(
              () => handler({ sender: { id: 11 } }, "ok") as Promise<unknown>,
            );

            expect(result).toBe("OK");
          }),
        );
      }),
  );

  it.effect("rejects schema contract args before running the handler", () =>
    Effect.gen(function* () {
      yield* withDesktopIpc((ipc) =>
        Effect.gen(function* () {
          const handlerRun = vi.fn();
          yield* ipc.handleContract(
            defineDesktopIpcInvokeContract({
              channel: "desktop:test:schema-args",
              argsSchema: Schema.Tuple([
                Schema.String,
              ]) as unknown as Schema.Codec<[string], unknown>,
              returnSchema: Schema.Void as Schema.Codec<void, unknown>,
            }),
            (_event, _value) =>
              Effect.sync(() => {
                handlerRun();
              }),
          );
          const handler = electronMock.handlers.get("desktop:test:schema-args");
          if (handler === undefined) {
            throw new Error("missing handler");
          }

          yield* Effect.promise(async () => {
            await expect(
              handler({ sender: { id: 12 } }, 1) as Promise<unknown>,
            ).rejects.toThrow();
          });
          expect(handlerRun).not.toHaveBeenCalled();
        }),
      );
    }),
  );

  it.effect("rejects schema contract return encode failures", () =>
    Effect.gen(function* () {
      yield* withDesktopIpc((ipc) =>
        Effect.gen(function* () {
          yield* ipc.handleContract(
            defineDesktopIpcInvokeContract({
              channel: "desktop:test:schema-return",
              argsSchema: Schema.Tuple([]) as unknown as Schema.Codec<
                [],
                unknown
              >,
              returnSchema: Schema.String as Schema.Codec<string, unknown>,
            }),
            () => Effect.succeed(1 as unknown as string),
          );
          const handler = electronMock.handlers.get(
            "desktop:test:schema-return",
          );
          if (handler === undefined) {
            throw new Error("missing handler");
          }

          yield* Effect.promise(async () => {
            await expect(
              handler({ sender: { id: 13 } }) as Promise<unknown>,
            ).rejects.toThrow();
          });
        }),
      );
    }),
  );
});
