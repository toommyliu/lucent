import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import type { AccountSessionReport } from "@lucent/core/accounts";
import { AccountSessions, layer } from "./AccountSessions";

const report = (
  rendererGeneration: number,
  revision: number,
  username: string,
): AccountSessionReport => ({
  rendererGeneration,
  revision,
  runtime: {
    connection: { state: "online", username },
    login: { state: "idle" },
    script: { state: "idle" },
  },
});

describe("AccountSessions", () => {
  it.effect("does not treat launch intent as an online identity", () =>
    Effect.gen(function* () {
      const sessions = yield* AccountSessions;
      sessions.openWindow(42, 7, 1);
      sessions.trackLaunch(42, 7, 1, {
        account: { label: "Alice", password: "secret", username: "Alice" },
        requestedAt: 10,
      });

      expect(sessions.snapshot()[0]).toMatchObject({
        connection: { state: "offline" },
        launch: { username: "Alice" },
        login: { state: "waiting-for-game" },
      });
    }).pipe(Effect.provide(layer)),
  );

  it.effect("ignores reports older than the accepted renderer revision", () =>
    Effect.gen(function* () {
      const sessions = yield* AccountSessions;
      sessions.openWindow(42, 7, 1);

      expect(sessions.applyReport(42, report(1, 2, "Bob"))).not.toBeNull();
      expect(sessions.applyReport(42, report(1, 1, "Alice"))).toBeNull();
      expect(sessions.snapshot()[0]?.connection).toEqual({
        state: "online",
        username: "Bob",
      });
    }).pipe(Effect.provide(layer)),
  );

  it.effect("uses renderer reload as an ordering barrier", () =>
    Effect.gen(function* () {
      const sessions = yield* AccountSessions;
      sessions.openWindow(42, 7, 1);
      sessions.applyReport(42, report(1, 5, "Alice"));
      sessions.reloadWindow(42, 7, 2);

      expect(sessions.applyReport(42, report(1, 6, "Alice"))).toBeNull();
      expect(sessions.applyReport(42, report(2, 1, "Bob"))).not.toBeNull();
      expect(sessions.snapshot()[0]?.connection).toEqual({
        state: "online",
        username: "Bob",
      });
    }).pipe(Effect.provide(layer)),
  );

  it.effect("does not recreate a closed window from a late report", () =>
    Effect.gen(function* () {
      const sessions = yield* AccountSessions;
      sessions.openWindow(42, 7, 1);
      sessions.remove(42);

      expect(sessions.applyReport(42, report(1, 1, "Alice"))).toBeNull();
      expect(sessions.snapshot()).toEqual([]);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("does not roll a reloaded window back for an old launch", () =>
    Effect.gen(function* () {
      const sessions = yield* AccountSessions;
      sessions.openWindow(42, 7, 1);
      sessions.reloadWindow(42, 7, 2);
      sessions.trackLaunch(42, 7, 1, {
        account: { label: "Alice", password: "secret", username: "Alice" },
        requestedAt: 10,
      });

      expect(sessions.snapshot()[0]).toMatchObject({
        rendererGeneration: 2,
      });
      expect(sessions.snapshot()[0]).not.toHaveProperty("launch");
    }).pipe(Effect.provide(layer)),
  );
});
