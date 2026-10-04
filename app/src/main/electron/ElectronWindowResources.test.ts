import { describe, expect, it } from "@effect/vitest";
import { vi } from "vitest";
import * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

const native = vi.hoisted(() => ({
  resources: [] as { destroyed: boolean }[],
  failGuard: false,
  closeContents: [] as (() => void)[],
  nextId: 0,
}));
vi.mock("electron", async () => {
  const { EventEmitter } = await import("node:events");
  const contents = () => {
    const state = { destroyed: false };
    const result = Object.assign(new EventEmitter(), {
      id: ++native.nextId,
      isDestroyed: () => state.destroyed,
      close: () => {
        state.destroyed = true;
        result.emit("destroyed");
      },
      setWindowOpenHandler: () => {
        if (native.failGuard) throw new Error("navigation setup failed");
      },
    });
    native.closeContents.push(result.close);
    return result;
  };
  class BaseWindow {
    state = { destroyed: false };
    constructor() {
      native.resources.push(this.state);
    }
    isDestroyed = () => this.state.destroyed;
    destroy = () => {
      this.state.destroyed = true;
    };
  }
  class BrowserWindow extends BaseWindow {
    webContents = contents();
    override destroy = () => {
      this.state.destroyed = true;
      this.webContents.close();
    };
  }
  class WebContentsView {
    target = contents();
    state = { destroyed: false };
    constructor() {
      native.resources.push(this.state);
      this.target.once("destroyed", () => {
        this.state.destroyed = true;
      });
    }
    get webContents() {
      if (this.state.destroyed) throw new Error("native accessor is invalid");
      return this.target;
    }
  }
  return { BrowserWindow, BaseWindow, WebContentsView };
});

import { ElectronWindow, layer as windowLayer } from "./ElectronWindow";
import { ElectronGameView, layer as viewLayer } from "./ElectronGameView";

const windowOptions = { height: 768, width: 1024 };
const createWindow = Effect.gen(function* () {
  return yield* (yield* ElectronWindow).create(windowOptions);
}).pipe(Effect.provide(windowLayer), Effect.asVoid);
const createView = Effect.gen(function* () {
  return yield* (yield* ElectronGameView).create({});
}).pipe(Effect.provide(viewLayer), Effect.asVoid);

const testResource = <E>(
  name: string,
  create: Effect.Effect<void, E, Scope.Scope>,
) => {
  describe(`scoped ${name}`, () => {
    it.effect("releases the native resource when setup fails", () =>
      Effect.gen(function* () {
        native.resources.length = 0;
        native.failGuard = true;
        const failed = yield* create.pipe(Effect.scoped, Effect.isFailure);
        native.failGuard = false;
        expect(failed).toBe(true);
        expect(native.resources).toEqual([{ destroyed: true }]);
      }),
    );
    it.effect("releases the native resource after use", () =>
      Effect.gen(function* () {
        native.resources.length = 0;
        native.failGuard = false;
        yield* create.pipe(Effect.scoped);
        expect(native.resources).toEqual([{ destroyed: true }]);
      }),
    );
  });
};

testResource("browser window", createWindow);
testResource("game view", createView);

it.effect(
  "destroys a browser window even if its contents were already destroyed",
  () =>
    Effect.gen(function* () {
      native.resources.length = 0;
      native.failGuard = false;
      yield* Effect.gen(function* () {
        yield* createWindow;
        native.closeContents.at(-1)!();
      }).pipe(Effect.scoped);
      expect(native.resources).toEqual([{ destroyed: true }]);
    }),
);
