import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type {
  GrabbedData,
  LoaderGrabberGrabRequest,
  LoaderGrabberLoadRequest,
} from "../../../shared/loader-grabber";
import type {
  LoaderGrabberRequest,
  LoaderGrabberResponse,
} from "../../../shared/ipc/loaderGrabber";
import { Api } from "./flash";
import type { flashRuntime } from "./flash";

type GameRuntime = Pick<typeof flashRuntime, "runPromise">;

export class LoaderGrabberOperationError extends Schema.TaggedErrorClass<LoaderGrabberOperationError>()(
  "LoaderGrabberOperationError",
  {
    detail: Schema.String,
  },
) {
  override get message(): string {
    return this.detail;
  }
}

const requirePlayerReady = Effect.fn("loaderGrabber.requirePlayerReady")(
  function* () {
    const api = yield* Api;
    if (!(yield* api.player.isReady())) {
      return yield* new LoaderGrabberOperationError({
        detail: "The player is not ready.",
      });
    }
    return api;
  },
);

export const loadWithLoaderGrabber = Effect.fn("loaderGrabber.load")(function* (
  request: LoaderGrabberLoadRequest,
) {
  const api = yield* requirePlayerReady();

  switch (request.type) {
    case "armor-customizer":
      yield* api.shops.loadArmorCustomize();
      return;
    case "hair-shop":
      yield* api.shops.loadHairShop(request.id);
      return;
    case "quest":
      if (!(yield* api.quests.load(request.id))) {
        return yield* new LoaderGrabberOperationError({
          detail: `Quest ${request.id} could not be loaded.`,
        });
      }
      return;
    case "shop":
      if (!(yield* api.shops.load(request.id))) {
        return yield* new LoaderGrabberOperationError({
          detail: `Shop ${request.id} could not be loaded.`,
        });
      }
  }
});

export const grabWithLoaderGrabber = Effect.fn("loaderGrabber.grab")(function* (
  request: LoaderGrabberGrabRequest,
): Effect.fn.Return<GrabbedData | null, LoaderGrabberOperationError, Api> {
  const api = yield* requirePlayerReady();

  switch (request.type) {
    case "shop": {
      const shop = yield* api.shops.getInfo();
      return shop?.toJSON() ?? null;
    }
    case "quest": {
      const quests = yield* api.quests.getAll();
      return quests.map((quest) => quest.toJSON());
    }
    case "inventory": {
      const items = yield* api.inventory.getAll();
      return items.map((item) => item.toJSON());
    }
    case "temp-inventory": {
      const items = yield* api.tempInventory.getAll();
      return items.map((item) => item.toJSON());
    }
    case "bank": {
      const items = yield* api.bank.getAll();
      return items.map((item) => item.toJSON());
    }
    case "cell-monsters": {
      const monsters = yield* api.monsters.getAvailable();
      return monsters.map((monster) => monster.toJSON());
    }
    case "map-monsters": {
      const monsters = yield* api.monsters.getAll();
      return monsters.map((monster) => monster.toJSON());
    }
  }
});

const errorMessage = (cause: unknown): string =>
  cause instanceof Error && cause.message !== ""
    ? cause.message
    : "The Loader grabber request failed.";

const sendResponse = (response: LoaderGrabberResponse): Promise<void> =>
  window.desktop.loaderGrabber.respond(response);

const handleRequest = async (
  runtime: GameRuntime,
  request: LoaderGrabberRequest,
): Promise<void> => {
  try {
    if (request.kind === "load") {
      await runtime.runPromise(loadWithLoaderGrabber(request.payload));
      await sendResponse({
        ok: true,
        outcome: { kind: "load" },
        requestId: request.requestId,
      });
      return;
    }

    const value = await runtime.runPromise(
      grabWithLoaderGrabber(request.payload),
    );
    await sendResponse({
      ok: true,
      outcome: { kind: "grab", value },
      requestId: request.requestId,
    });
  } catch (cause) {
    await sendResponse({
      error: errorMessage(cause),
      ok: false,
      requestId: request.requestId,
    });
  }
};

export interface LoaderGrabberBridgeController {
  readonly dispose: () => void;
}

export const installLoaderGrabberBridge = (
  runtime: GameRuntime,
): LoaderGrabberBridgeController => {
  let disposed = false;
  let requests = Promise.resolve();

  const unsubscribe = window.desktop.loaderGrabber.onRequest((request) => {
    requests = requests
      .catch((cause: unknown) => {
        console.error("[game:loader-grabber] request queue failed", cause);
      })
      .then(() =>
        disposed
          ? sendResponse({
              error: "The Loader grabber bridge is unavailable.",
              ok: false,
              requestId: request.requestId,
            })
          : handleRequest(runtime, request),
      );
    void requests.catch((cause: unknown) => {
      console.error("[game:loader-grabber] response failed", cause);
    });
  });

  return {
    dispose: () => {
      disposed = true;
      unsubscribe();
    },
  };
};
