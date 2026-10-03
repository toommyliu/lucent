import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { DEFAULT_APP_SETTINGS } from "@lucent/core/settings";
import { defineInvoke, SettingsIpc } from "../../shared/ipc";
import { createDesktopIpcInvokeHandler } from "./DesktopIpcInvoke";

describe("createDesktopIpcInvokeHandler", () => {
  it.effect("unwraps traced requests and continues the renderer trace", () =>
    Effect.gen(function* () {
      const descriptor = defineInvoke({
        channel: "desktop:test:trace",
        name: "test.trace",
        payload: Schema.String,
        result: Schema.String,
      });
      const invoke = createDesktopIpcInvokeHandler(
        descriptor,
        (payload) =>
          Effect.currentSpan.pipe(
            Effect.map((span) => `${payload}:${span.traceId}:${span.name}`),
          ),
        Effect.runPromise,
        () => 42,
      );

      const envelope = yield* Effect.promise(() =>
        invoke(undefined, {
          payload: "hello",
          trace: {
            traceId: "renderer-trace",
            spanId: "renderer-span",
            sampled: true,
          },
        }),
      );

      expect(envelope).toEqual({
        ok: true,
        value: "hello:renderer-trace:ipc.handler test.trace",
      });
    }),
  );

  it.effect(
    "rejects malformed tracing envelopes before running a mutation",
    () =>
      Effect.gen(function* () {
        let saveCount = 0;
        const invoke = createDesktopIpcInvokeHandler(
          SettingsIpc.updatePreferences,
          () =>
            Effect.sync(() => {
              saveCount += 1;
              return DEFAULT_APP_SETTINGS;
            }),
          Effect.runPromise,
          () => 42,
        );

        const envelope = yield* Effect.promise(() =>
          invoke(undefined, {
            payload: { checkForUpdates: false },
            trace: { sampled: true },
          }),
        );

        expect(envelope).toMatchObject({
          ok: false,
          error: {
            channel: SettingsIpc.updatePreferences.channel,
            code: "IPC_HANDLER_FAILED",
          },
        });
        expect(saveCount).toBe(0);
      }),
  );

  it.effect(
    "rejects invalid mutation payloads before running the handler",
    () =>
      Effect.gen(function* () {
        let saveCount = 0;
        const invoke = createDesktopIpcInvokeHandler(
          SettingsIpc.updatePreferences,
          () =>
            Effect.sync(() => {
              saveCount += 1;
              return DEFAULT_APP_SETTINGS;
            }),
          Effect.runPromise,
        );

        const envelope = yield* Effect.promise(() =>
          invoke(undefined, { checkForUpdates: "yes" }),
        );

        expect(envelope.ok).toBe(false);
        if (!envelope.ok) {
          expect(envelope.error.channel).toBe(
            SettingsIpc.updatePreferences.channel,
          );
        }
        expect(saveCount).toBe(0);
      }),
  );

  it.effect("rejects unknown appearance token payloads before saving", () =>
    Effect.gen(function* () {
      let saveCount = 0;
      const invoke = createDesktopIpcInvokeHandler(
        SettingsIpc.updateAppearance,
        () =>
          Effect.sync(() => {
            saveCount += 1;
            return DEFAULT_APP_SETTINGS;
          }),
        Effect.runPromise,
      );

      const envelope = yield* Effect.promise(() =>
        invoke(undefined, {
          themes: {
            dark: {
              tokens: {
                bogus: [1, 2, 3],
              },
            },
          },
        }),
      );

      expect(envelope.ok).toBe(false);
      if (!envelope.ok) {
        expect(envelope.error.channel).toBe(
          SettingsIpc.updateAppearance.channel,
        );
      }
      expect(saveCount).toBe(0);
    }),
  );

  it.effect("accepts a single-token appearance patch", () =>
    Effect.gen(function* () {
      const savedPatches: unknown[] = [];
      const invoke = createDesktopIpcInvokeHandler(
        SettingsIpc.updateAppearance,
        (patch) =>
          Effect.sync(() => {
            savedPatches.push(patch);
            return DEFAULT_APP_SETTINGS;
          }),
        Effect.runPromise,
      );

      const envelope = yield* Effect.promise(() =>
        invoke(undefined, {
          themes: {
            dark: {
              tokens: {
                background: [1, 2, 3],
              },
            },
          },
        }),
      );

      expect(envelope.ok).toBe(true);
      expect(savedPatches).toEqual([
        { themes: { dark: { tokens: { background: [1, 2, 3] } } } },
      ]);
    }),
  );
});
