import { createIdleFollowerState } from "@lucent/core/follower";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Ref from "effect/Ref";

import {
  FollowerIpc,
  type FollowerCommand,
} from "../../../shared/ipc/follower";
import { DesktopIpc } from "../../ipc/DesktopIpc";
import { DesktopWindows } from "../../window/DesktopWindows";
import { makeGameFollowers } from "./GameFollowers";

describe("GameFollowers", () => {
  it.effect("isolates, deduplicates, and clears cached player rosters", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const sent = yield* Ref.make<
          readonly {
            readonly ids: readonly number[];
            readonly payload: unknown;
          }[]
        >([]);
        const ipc = DesktopIpc.of({
          handle: () => Effect.void,
          sendToAll: () => Effect.void,
          sendToBrowserWindowIds: (ids, descriptor, payload) =>
            descriptor.channel === FollowerIpc.playersChanged.channel
              ? Ref.update(sent, (messages) => [...messages, { ids, payload }])
              : Effect.void,
        });
        const windows = {
          getOwnedBrowserWindowIds: (browserWindowId: number) =>
            Effect.succeed([browserWindowId + 100]),
          onClosed: () => Effect.succeed(() => undefined),
          onRendererDestroyed: () => Effect.succeed(() => undefined),
        } as unknown as DesktopWindows["Service"];
        const followers = yield* makeGameFollowers.pipe(
          Effect.provideService(DesktopIpc, ipc),
          Effect.provideService(DesktopWindows, windows),
        );

        expect(yield* followers.getPlayers(42)).toEqual([]);
        expect(
          (yield* followers.setPlayers(42, ["Alice", "Bob"])).changed,
        ).toBe(true);
        expect(
          (yield* followers.setPlayers(42, ["Alice", "Bob"])).changed,
        ).toBe(false);
        expect(yield* followers.getPlayers(42)).toEqual(["Alice", "Bob"]);
        expect(yield* followers.getPlayers(43)).toEqual([]);

        yield* followers.remove(42);
        expect(yield* followers.getPlayers(42)).toEqual([]);
        expect(yield* Ref.get(sent)).toEqual([{ ids: [142], payload: [] }]);
      }),
    ),
  );

  it.effect("correlates a game response with its pending command", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const sent = yield* Ref.make<FollowerCommand | undefined>(undefined);
        const ipc = DesktopIpc.of({
          handle: () => Effect.void,
          sendToAll: () => Effect.void,
          sendToBrowserWindowIds: (_ids, _descriptor, payload) =>
            Ref.set(sent, payload as FollowerCommand),
        });
        const windows = {
          onClosed: () => Effect.succeed(() => undefined),
          onRendererDestroyed: () => Effect.succeed(() => undefined),
        } as unknown as DesktopWindows["Service"];
        const followers = yield* makeGameFollowers.pipe(
          Effect.provideService(DesktopIpc, ipc),
          Effect.provideService(DesktopWindows, windows),
        );

        const pending = yield* Effect.forkScoped(
          followers.request(42, { kind: "get-state" }),
        );
        yield* Effect.yieldNow;
        const command = yield* Ref.get(sent);
        expect(command?.kind).toBe("get-state");

        const state = {
          ...createIdleFollowerState(),
          enabled: true,
          phase: "following" as const,
          running: true,
          targetName: "target",
        };
        yield* followers.respond(42, {
          ok: true,
          outcome: { kind: "get-state", state },
          requestId: command!.requestId,
        });

        expect(yield* Fiber.join(pending)).toEqual({
          kind: "get-state",
          state,
        });
      }),
    ),
  );
});
