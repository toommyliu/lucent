import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { DEFAULT_APP_SETTINGS } from "../../shared/settings";
import { SettingsIpc } from "../../shared/ipc";
import { createDesktopIpcInvokeHandler } from "./DesktopIpcInvoke";

describe("createDesktopIpcInvokeHandler", () => {
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
                background: [1, 2, 3],
              },
            },
          },
        }),
      );

      expect(envelope.ok).toBe(true);
      expect(saveCount).toBe(1);
    }),
  );
});
