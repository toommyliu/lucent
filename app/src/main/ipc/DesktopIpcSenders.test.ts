import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { DesktopRendererKind } from "../window/DesktopWindowCatalog";
import { DesktopWindows } from "../window/DesktopWindows";
import {
  DesktopIpcSenderError,
  makeDesktopIpcSenders,
  resolveGameRendererId,
} from "./DesktopIpcSenders";

const event = { sender: { id: 42 } };
const makeWindows = (kind: DesktopRendererKind | null) => ({
  getRendererKind: () => Effect.succeed(kind),
});

describe("DesktopIpcSenders", () => {
  it.effect("resolves an allowed sender with its managed window identity", () =>
    Effect.gen(function* () {
      const senders = makeDesktopIpcSenders(makeWindows("game"));

      const sender = yield* senders.require(event, ["game"]);

      expect(sender).toEqual({
        rendererId: 42,
        kind: "game",
      });
    }),
  );

  it.effect("rejects a managed window of the wrong kind", () =>
    Effect.gen(function* () {
      const senders = makeDesktopIpcSenders(makeWindows("settings"));

      const error = yield* Effect.flip(senders.require(event, ["game"]));

      expect(error).toBeInstanceOf(DesktopIpcSenderError);
      expect(error.message).toBe("IPC sender must be one of: game");
    }),
  );

  it.effect("rejects unmanaged web contents", () =>
    Effect.gen(function* () {
      const unmanagedWindows = makeWindows(null);
      const unmanagedSenders = makeDesktopIpcSenders(unmanagedWindows);

      const error = yield* Effect.flip(
        unmanagedSenders.require(event, ["game"]),
      );

      expect(error).toBeInstanceOf(DesktopIpcSenderError);
      expect(error.message).toBe("IPC sender must be one of: game");
    }),
  );

  it.effect("routes child windows to their live game owner", () =>
    Effect.gen(function* () {
      expect(
        yield* resolveGameRendererId({ rendererId: 42, kind: "game" }).pipe(
          Effect.provide(Layer.mock(DesktopWindows, {})),
        ),
      ).toBe(42);
      expect(
        yield* resolveGameRendererId({ rendererId: 8, kind: "packets" }).pipe(
          Effect.provide(
            Layer.mock(DesktopWindows, {
              getOwnerRendererId: () => Effect.succeed(42),
              getRendererKind: () => Effect.succeed("game"),
            }),
          ),
        ),
      ).toBe(42);
      for (const kind of [null, "settings"] as const) {
        const error = yield* resolveGameRendererId({
          rendererId: 8,
          kind: "packets",
        }).pipe(
          Effect.provide(
            Layer.mock(DesktopWindows, {
              getOwnerRendererId: () =>
                Effect.succeed(kind === null ? null : 42),
              getRendererKind: () => Effect.succeed(kind),
            }),
          ),
          Effect.flip,
        );
        expect(error).toBeInstanceOf(DesktopIpcSenderError);
      }
    }),
  );
});
