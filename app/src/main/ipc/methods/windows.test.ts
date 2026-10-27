import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
  DesktopWindowError,
  DesktopWindows,
} from "../../window/DesktopWindows";
import { makeLifetime } from "../../window/RendererLifetimeTesting";
import { open } from "./windows";

it.effect.each([
  { senderKind: "game", kind: "game" },
  { senderKind: "game", kind: "settings" },
  { senderKind: "game", kind: "about" },
  { senderKind: "follower", kind: "game" },
  { senderKind: "follower", kind: "settings" },
  { senderKind: "follower", kind: "about" },
  { senderKind: "follower", kind: "environment" },
  { senderKind: "follower", kind: "loader-grabber" },
  { senderKind: "follower", kind: "follower" },
  { senderKind: "follower", kind: "packets" },
  { senderKind: "follower", kind: "account-manager" },
] as const)("rejects $senderKind opening $kind", ({ senderKind, kind }) =>
  Effect.gen(function* () {
    const opened: unknown[] = [];
    const result = yield* open
      .handler(
        { kind },
        { kind: senderKind, rendererId: 42, lifetime: makeLifetime(42) },
      )
      .pipe(
        Effect.provide(
          Layer.mock(DesktopWindows, {
            open: (windowKind, options) =>
              Effect.sync(() => {
                opened.push({ kind: windowKind, options });
                return 142;
              }),
          }),
        ),
        Effect.catchTag("DesktopWindowError", Effect.succeed),
      );

    expect(result).toBeInstanceOf(DesktopWindowError);
    expect(result).toMatchObject({ _tag: "DesktopWindowError", id: kind });
    expect(opened).toEqual([]);
  }),
);

it.effect.each([
  { senderKind: "game", kind: "environment", options: { ownerRendererId: 42 } },
  {
    senderKind: "game",
    kind: "loader-grabber",
    options: { ownerRendererId: 42 },
  },
  { senderKind: "game", kind: "follower", options: { ownerRendererId: 42 } },
  { senderKind: "game", kind: "packets", options: { ownerRendererId: 42 } },
  { senderKind: "game", kind: "account-manager", options: undefined },
  { senderKind: "game", kind: "combat-profiles", options: undefined },
  { senderKind: "follower", kind: "combat-profiles", options: undefined },
] as const)(
  "allows $senderKind opening $kind",
  ({ senderKind, kind, options }) =>
    Effect.gen(function* () {
      const opened: unknown[] = [];
      const result = yield* open
        .handler(
          { kind },
          { kind: senderKind, rendererId: 42, lifetime: makeLifetime(42) },
        )
        .pipe(
          Effect.provide(
            Layer.mock(DesktopWindows, {
              open: (windowKind, windowOptions) =>
                Effect.sync(() => {
                  opened.push({ kind: windowKind, options: windowOptions });
                  return 142;
                }),
            }),
          ),
        );

      expect(result).toBe("142");
      expect(opened).toEqual([{ kind, options }]);
    }),
);
