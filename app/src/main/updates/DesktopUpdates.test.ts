import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import { describe, expect, it } from "@effect/vitest";
import { afterEach, vi } from "vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { DEFAULT_APP_SETTINGS, type AppSettings } from "@lucent/core/settings";
import { DesktopEnvironment } from "../app/DesktopEnvironment";
import { DesktopObservability } from "../app/DesktopObservability";
import { ElectronApp } from "../electron/ElectronApp";
import { ElectronShell } from "../electron/ElectronShell";
import {
  GitHubApiClient,
  makeGitHubApiClient,
} from "../github/GitHubApiClient";
import {
  DesktopHttpClient,
  DesktopHttpClientError,
  type DesktopHttpGetOptions,
  type DesktopHttpResponse,
} from "../http/DesktopHttpClient";
import { DesktopSettings } from "../settings/DesktopSettings";
import { DesktopUpdates, layer as desktopUpdatesLayer } from "./DesktopUpdates";

vi.mock("electron", () => ({
  app: {},
  shell: {
    openExternal: vi.fn(),
  },
}));

const httpRequests: DesktopHttpGetOptions[] = [];
const httpResponses: DesktopHttpResponse[] = [];

const httpClient = DesktopHttpClient.of({
  get: (options) =>
    Effect.gen(function* () {
      httpRequests.push(options);
      const response = httpResponses.shift();
      if (response === undefined) {
        return yield* new DesktopHttpClientError({
          kind: "request-failed",
          detail: "No test HTTP response was queued.",
          url: options.url.href,
        });
      }
      return response;
    }),
  download: (options) =>
    Effect.fail(
      new DesktopHttpClientError({
        kind: "request-failed",
        detail: "The update checker must not download files.",
        url: options.url.href,
      }),
    ),
});

const mockGitHubResponse = (options: {
  readonly body?: string;
  readonly headers?: Record<string, string>;
  readonly statusCode?: number;
  readonly statusMessage?: string;
}): void => {
  httpResponses.push({
    body: Buffer.from(options.body ?? "", "utf8"),
    headers: options.headers ?? {},
    statusCode: options.statusCode ?? 200,
    statusMessage: options.statusMessage ?? "OK",
    url: "https://api.github.com/repos/toommyliu/lucent/releases/latest",
  });
};

const testSettings = (checkForUpdates: boolean): AppSettings => ({
  ...DEFAULT_APP_SETTINGS,
  preferences: {
    ...DEFAULT_APP_SETTINGS.preferences,
    checkForUpdates,
  },
});

const tempDirs = new Set<string>();

const makeTempDir = async (prefix: string): Promise<string> => {
  const path = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.add(path);
  return path;
};

const makeUpdatesHarness = (options: {
  readonly cache?: unknown;
  readonly checkForUpdates: boolean;
  readonly currentVersion: string;
}) =>
  Effect.gen(function* () {
    const appDataDir = yield* Effect.promise(() =>
      makeTempDir("lucent-updates-data-"),
    );
    const workspaceDir = yield* Effect.promise(() =>
      makeTempDir("lucent-updates-workspace-"),
    );
    const env = DesktopEnvironment.of({
      appDataDir,
      assetsDir: join(appDataDir, "assets"),
      isDev: true,
      platform: "darwin",
      workspaceDir,
    });
    if (options.cache !== undefined) {
      yield* Effect.promise(() =>
        writeFile(
          join(env.appDataDir, "release-cache.json"),
          JSON.stringify(options.cache),
          "utf8",
        ),
      );
    }

    const settings = testSettings(options.checkForUpdates);
    const settingsService = DesktopSettings.of({
      get: Effect.succeed(settings),
      load: Effect.succeed(settings),
      onChanged: () => Effect.succeed(() => undefined),
      resetAppearance: Effect.succeed(settings),
      resetHotkeys: Effect.succeed(settings),
      updateAppearance: () => Effect.succeed(settings),
      updateHotkeys: () => Effect.succeed(settings),
      updatePreferences: () => Effect.succeed(settings),
    });
    const observability = DesktopObservability.of({
      debug: () => Effect.void,
      error: () => Effect.void,
      info: () => Effect.void,
      installProcessHooks: Effect.void,
      logFilePath: join(env.appDataDir, "logs", "lucent.log"),
      record: () => Effect.void,
      recordUnsafe: () => undefined,
      subscribe: () => () => undefined,
      warn: () => Effect.void,
    });
    const app = ElectronApp.of({
      appendCommandLineSwitch: () => Effect.void,
      exit: () => Effect.void,
      getAppMetrics: Effect.succeed([]),
      getVersion: Effect.succeed(options.currentVersion),
      isPackaged: Effect.succeed(false),
      on: () => Effect.succeed(() => undefined),
      relaunch: Effect.void,
      quit: Effect.void,
      whenReady: Effect.void,
    });
    const shell = ElectronShell.of({
      openExternal: () => Effect.succeed(true),
      openPath: () => Effect.succeed(true),
      showItemInFolder: () => Effect.void,
    });
    const layer = desktopUpdatesLayer.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(DesktopEnvironment, env),
          Layer.succeed(DesktopObservability, observability),
          Layer.succeed(ElectronApp, app),
          Layer.succeed(ElectronShell, shell),
          Layer.succeed(
            GitHubApiClient,
            makeGitHubApiClient(httpClient, `Lucent/${options.currentVersion}`),
          ),
          Layer.succeed(DesktopSettings, settingsService),
        ),
      ),
    );

    return { env, layer };
  });

afterEach(async () => {
  vi.clearAllMocks();
  httpRequests.length = 0;
  httpResponses.length = 0;
  await Promise.all(
    [...tempDirs].map((path) => rm(path, { force: true, recursive: true })),
  );
  tempDirs.clear();
});

describe("DesktopUpdates", () => {
  it.effect("starts disabled when update checks are disabled", () =>
    Effect.gen(function* () {
      const harness = yield* makeUpdatesHarness({
        checkForUpdates: false,
        currentVersion: "1.0.0",
      });
      const updates = yield* DesktopUpdates.pipe(Effect.provide(harness.layer));

      const state = yield* updates.getState;

      expect(state.status).toBe("disabled");
      if (state.status === "disabled") {
        expect(state.reason).toContain("disabled");
      }
      expect(httpRequests).toHaveLength(0);
    }),
  );

  it.effect(
    "parses stable GitHub releases and reports newer semver versions",
    () =>
      Effect.gen(function* () {
        mockGitHubResponse({
          body: JSON.stringify({
            draft: false,
            html_url: "https://github.com/toommyliu/lucent/releases/tag/v1.2.3",
            name: "Lucent 1.2.3",
            prerelease: false,
            published_at: "2026-06-23T00:00:00Z",
            tag_name: "v1.2.3",
          }),
          headers: { etag: "etag-2" },
        });
        const { env, layer } = yield* makeUpdatesHarness({
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
        const cache = JSON.parse(
          yield* Effect.promise(() =>
            readFile(join(env.appDataDir, "release-cache.json"), "utf8"),
          ),
        ) as {
          readonly etag?: string;
          readonly release?: { readonly tagName?: string };
        };
        expect(cache.etag).toBe("etag-2");
        expect(cache.release?.tagName).toBe("v1.2.3");
      }),
  );

  it.effect("rejects draft and prerelease payloads", () =>
    Effect.gen(function* () {
      mockGitHubResponse({
        body: JSON.stringify({
          draft: true,
          html_url: "https://github.com/toommyliu/lucent/releases/tag/v1.2.3",
          prerelease: false,
          tag_name: "v1.2.3",
        }),
      });
      const draftHarness = yield* makeUpdatesHarness({
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
          html_url: "https://github.com/toommyliu/lucent/releases/tag/v1.2.3",
          prerelease: true,
          tag_name: "v1.2.3",
        }),
      });
      const prereleaseHarness = yield* makeUpdatesHarness({
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
        const harness = yield* makeUpdatesHarness({
          cache: {
            etag: "etag-1",
            release: {
              htmlUrl:
                "https://github.com/toommyliu/lucent/releases/tag/v1.0.0",
              tagName: "v1.0.0",
              version: "1.0.0",
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
        expect(httpRequests[0]?.headers).toMatchObject({
          "If-None-Match": "etag-1",
        });

        httpRequests.length = 0;
        httpResponses.length = 0;
        const disabledHarness = yield* makeUpdatesHarness({
          checkForUpdates: false,
          currentVersion: "1.0.0",
        });
        const disabledUpdates = yield* DesktopUpdates.pipe(
          Effect.provide(disabledHarness.layer),
        );
        const disabledState = yield* disabledUpdates.checkNow();

        expect(disabledState.status).toBe("disabled");
        expect(httpRequests).toHaveLength(0);
      }),
  );
});
