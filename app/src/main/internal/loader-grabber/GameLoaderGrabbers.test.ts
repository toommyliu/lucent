import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Ref from "effect/Ref";

import type { LoaderGrabberRequest } from "../../../shared/ipc/loaderGrabber";
import { DesktopIpc } from "../../ipc/DesktopIpc";
import { DesktopWindows } from "../../window/DesktopWindows";
import { makeGameLoaderGrabbers } from "./GameLoaderGrabbers";

describe("GameLoaderGrabbers", () => {
  it.effect("correlates responses with the requesting game and operation", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const sent = yield* Ref.make<LoaderGrabberRequest | undefined>(
          undefined,
        );
        const ipc = DesktopIpc.of({
          handle: () => Effect.void,
          sendToAll: () => Effect.void,
          sendToBrowserWindowIds: (_ids, _descriptor, payload) =>
            Ref.set(sent, payload as LoaderGrabberRequest),
        });
        const windows = {
          isRendererReady: () => Effect.succeed(true),
          onClosed: () => Effect.succeed(() => undefined),
          onRendererDestroyed: () => Effect.succeed(() => undefined),
          onRendererReloaded: () => Effect.succeed(() => undefined),
        } as unknown as DesktopWindows["Service"];
        const loaderGrabbers = yield* makeGameLoaderGrabbers.pipe(
          Effect.provideService(DesktopIpc, ipc),
          Effect.provideService(DesktopWindows, windows),
        );

        const pending = yield* Effect.forkScoped(
          loaderGrabbers.request(42, {
            kind: "grab",
            payload: { type: "inventory" },
          }),
        );
        yield* Effect.yieldNow;
        const request = yield* Ref.get(sent);
        expect(request?.kind).toBe("grab");

        yield* loaderGrabbers.respond(7, {
          ok: true,
          outcome: { kind: "grab", value: null },
          requestId: request!.requestId,
        });

        yield* loaderGrabbers.respond(42, {
          ok: true,
          outcome: { kind: "grab", value: [] },
          requestId: request!.requestId,
        });
        expect(yield* Fiber.join(pending)).toEqual({
          kind: "grab",
          value: [],
        });
      }),
    ),
  );
});
