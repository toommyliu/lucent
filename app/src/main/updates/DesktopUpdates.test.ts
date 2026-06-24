import { EventEmitter } from "events";
import { get as httpsGet } from "https";
import { join } from "path";

import { describe, expect, it } from "@effect/vitest";
import { afterEach, vi } from "vitest";
import { Effect, Layer } from "effect";

import { DEFAULT_APP_SETTINGS, type AppSettings } from "../../shared/settings";
import {
  DesktopEnvironment,
  makeDesktopEnvironment,
} from "../app/DesktopEnvironment";
import { DesktopObservability } from "../app/DesktopObservability";
import { DesktopData, type JsonFileReadResult } from "../data/DesktopData";
import { ElectronApp } from "../electron/ElectronApp";
import { DesktopUpdates, layer as desktopUpdatesLayer } from "./DesktopUpdates";

vi.mock("electron", () => ({
  app: {},
}));

vi.mock("https", () => ({
  get: vi.fn(),
}));

type HttpsResponse = EventEmitter & {
  readonly headers: Record<string, string>;
  readonly statusCode: number;
  readonly statusMessage: string;
};

type HttpsRequest = EventEmitter & {
  destroy: (error?: Error) => void;
  setTimeout: (milliseconds: number, listener: () => void) => HttpsRequest;
};

type HttpsGetMock = {
  readonly mockImplementationOnce: (
    implementation: (...args: readonly unknown[]) => HttpsRequest,
  ) => void;
};

const getMock = httpsGet as unknown as HttpsGetMock;

const responseCallbackFrom = (
  args: readonly unknown[],
): ((response: HttpsResponse) => void) => {
  const callback = args.find(
    (arg): arg is (response: HttpsResponse) => void =>
      typeof arg === "function",
  );
  if (callback === undefined) {
    throw new Error("https.get test mock expected a response callback.");
  }
  return callback;
};

const mockGitHubResponse = (options: {
  readonly body?: string;
  readonly headers?: Record<string, string>;
  readonly statusCode?: number;
  readonly statusMessage?: string;
}) => {
  getMock.mockImplementationOnce((...args) => {
    const callback = responseCallbackFrom(args);
    const request = new EventEmitter() as HttpsRequest;
    request.setTimeout = () => request;
    request.destroy = (error?: Error) => {
      if (error !== undefined) {
        request.emit("error", error);
      }
    };

    process.nextTick(() => {
      const response = new EventEmitter() as HttpsResponse;
      Object.assign(response, {
        headers: options.headers ?? {},
        statusCode: options.statusCode ?? 200,
        statusMessage: options.statusMessage ?? "OK",
      });
      callback(response);
      if (options.body !== undefined) {
        response.emit("data", options.body);
      }
      response.emit("end");
    });

    return request;
  });
};

const testSettings = (checkForUpdates: boolean): AppSettings => ({
  ...DEFAULT_APP_SETTINGS,
  preferences: {
    ...DEFAULT_APP_SETTINGS.preferences,
    checkForUpdates,
  },
});

const makeUpdatesHarness = (options: {
  readonly cache?: JsonFileReadResult;
  readonly checkForUpdates: boolean;
  readonly currentVersion: string;
}) => {
  const appDataDir = "/tmp/lucent-updates";
  const env = makeDesktopEnvironment({
    appDataDir,
    assetsDir: join(appDataDir, "assets"),
    isDev: true,
    platform: "darwin",
    rendererDir: join(appDataDir, "renderer"),
    workspaceDir: join(appDataDir, "workspace"),
  });
  const writes: Array<{ readonly path: string; readonly value: unknown }> = [];
  const settings = testSettings(options.checkForUpdates);
  const data = DesktopData.of({
    getSettings: Effect.succeed(settings),
    loadSettings: Effect.succeed(settings),
    readJson: () =>
      Effect.succeed(options.cache ?? ({ status: "missing" } as const)),
    saveSettings: (nextSettings) => Effect.succeed(nextSettings),
    writeJson: (path, value) =>
      Effect.sync(() => {
        writes.push({ path, value });
      }),
  });
  const observability = DesktopObservability.of({
    debug: () => Effect.void,
    error: () => Effect.void,
    info: () => Effect.void,
    installProcessHooks: Effect.void,
    warn: () => Effect.void,
  });
  const app = ElectronApp.of({
    appendCommandLineSwitch: () => Effect.void,
    exit: () => Effect.void,
    getVersion: Effect.succeed(options.currentVersion),
    isPackaged: Effect.succeed(false),
    on: () => Effect.succeed(() => undefined),
    quit: Effect.void,
    whenReady: Effect.void,
  });
  const layer = desktopUpdatesLayer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(DesktopEnvironment, env),
        Layer.succeed(DesktopData, data),
        Layer.succeed(DesktopObservability, observability),
        Layer.succeed(ElectronApp, app),
      ),
    ),
  );

  return { env, layer, writes };
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("DesktopUpdates", () => {
  it.effect(
    "parses stable GitHub releases and reports newer semver versions",
    () =>
      Effect.gen(function* () {
        mockGitHubResponse({
          body: JSON.stringify({
            draft: false,
            html_url: "https://example.test/release",
            name: "Lucent 1.2.3",
            prerelease: false,
            published_at: "2026-06-23T00:00:00Z",
            tag_name: "v1.2.3",
          }),
          headers: { etag: "etag-2" },
        });
        const { env, layer, writes } = makeUpdatesHarness({
          checkForUpdates: true,
          currentVersion: "1.2.2",
        });
        const updates = yield* DesktopUpdates.pipe(Effect.provide(layer));

        const state = yield* updates.checkNow();

        expect(state.status).toBe("available");
        if (state.status === "available") {
          expect(state.latestVersion).toBe("1.2.3");
          expect(state.release.tagName).toBe("v1.2.3");
        }
        expect(writes).toHaveLength(1);
        expect(writes[0]).toMatchObject({
          path: env.releaseCachePath,
          value: { etag: "etag-2" },
        });
      }),
  );

  it.effect("rejects draft and prerelease payloads", () =>
    Effect.gen(function* () {
      mockGitHubResponse({
        body: JSON.stringify({
          draft: true,
          html_url: "https://example.test/release",
          prerelease: false,
          tag_name: "v1.2.3",
        }),
      });
      const draftHarness = makeUpdatesHarness({
        checkForUpdates: true,
        currentVersion: "1.2.2",
      });
      const draftUpdates = yield* DesktopUpdates.pipe(
        Effect.provide(draftHarness.layer),
      );
      const draftState = yield* draftUpdates.checkNow();

      expect(draftState.status).toBe("error");
      if (draftState.status === "error") {
        expect(draftState.message).toContain("stable release");
      }

      mockGitHubResponse({
        body: JSON.stringify({
          draft: false,
          html_url: "https://example.test/release",
          prerelease: true,
          tag_name: "v1.2.3",
        }),
      });
      const prereleaseHarness = makeUpdatesHarness({
        checkForUpdates: true,
        currentVersion: "1.2.2",
      });
      const prereleaseUpdates = yield* DesktopUpdates.pipe(
        Effect.provide(prereleaseHarness.layer),
      );
      const prereleaseState = yield* prereleaseUpdates.checkNow();

      expect(prereleaseState.status).toBe("error");
      if (prereleaseState.status === "error") {
        expect(prereleaseState.message).toContain("stable release");
      }
    }),
  );

  it.effect(
    "reuses cached ETags and skips network work while updates are disabled",
    () =>
      Effect.gen(function* () {
        mockGitHubResponse({
          statusCode: 304,
        });
        const harness = makeUpdatesHarness({
          cache: {
            status: "ok",
            value: {
              etag: "etag-1",
              release: {
                htmlUrl: "https://example.test/release",
                tagName: "v1.0.0",
                version: "1.0.0",
              },
            },
          },
          checkForUpdates: true,
          currentVersion: "1.0.0",
        });
        const updates = yield* DesktopUpdates.pipe(
          Effect.provide(harness.layer),
        );

        const state = yield* updates.checkNow();

        expect(state.status).toBe("current");
        expect(vi.mocked(httpsGet).mock.calls[0]?.[1]).toMatchObject({
          headers: { "If-None-Match": "etag-1" },
        });

        vi.clearAllMocks();
        const disabledHarness = makeUpdatesHarness({
          checkForUpdates: false,
          currentVersion: "1.0.0",
        });
        const disabledUpdates = yield* DesktopUpdates.pipe(
          Effect.provide(disabledHarness.layer),
        );
        const disabledState = yield* disabledUpdates.checkNow();

        expect(disabledState.status).toBe("disabled");
        expect(vi.mocked(httpsGet)).not.toHaveBeenCalled();
      }),
  );
});
