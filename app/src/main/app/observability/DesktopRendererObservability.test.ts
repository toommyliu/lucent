import { EventEmitter } from "node:events";
import { expect, it } from "@effect/vitest";
import { vi } from "vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Scope from "effect/Scope";
vi.mock("electron", async () => {
  const { EventEmitter } = await import("node:events");
  return { app: new EventEmitter(), ipcMain: new EventEmitter() };
});
import { app, ipcMain } from "electron";
import {
  DesktopObservability,
  type DesktopDiagnosticRecord,
} from "./DesktopObservability";
import { installDesktopRendererObservability } from "./DesktopRendererObservability";

it.effect(
  "releases each renderer's observers and the installer without retaining closed contents",
  () =>
    Effect.gen(function* () {
      const records: DesktopDiagnosticRecord[] = [];
      const scope = yield* Scope.fork(yield* Effect.scope);
      yield* installDesktopRendererObservability.pipe(
        Effect.provideService(DesktopObservability, {
          flush: Effect.void,
          installProcessHooks: Effect.void,
          logFilePath: "unused",
          record: (record) =>
            Effect.sync(() => {
              records.push(record);
            }),
          recordUnsafe: (record) => {
            records.push(record);
          },
        }),
        Scope.provide(scope),
      );
      const first = Object.assign(new EventEmitter(), {
        id: 1,
        isDestroyed: () => false,
      });
      const second = Object.assign(new EventEmitter(), {
        id: 2,
        isDestroyed: () => false,
      });
      app.emit("web-contents-created", {}, first);
      app.emit("web-contents-created", {}, second);
      first.emit("unresponsive");
      second.emit("responsive");
      first.emit("destroyed");
      yield* Effect.yieldNow;
      first.emit("unresponsive");
      expect(records.map((record) => record.event)).toEqual([
        "unresponsive",
        "responsive",
      ]);
      expect(first.eventNames()).toEqual([]);
      yield* Scope.close(scope, Exit.void);
      expect(second.eventNames()).toEqual([]);
      expect(app.eventNames()).toEqual([]);
      expect(ipcMain.eventNames()).toEqual([]);
    }),
);
