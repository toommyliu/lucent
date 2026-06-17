import { EventEmitter } from "events";
import type { ClientRequest, IncomingMessage } from "http";
import { get as httpsGet } from "https";
import { Effect } from "effect";
import { beforeEach, describe, expect, it } from "@effect/vitest";
import { vi } from "vitest";

vi.mock("electron", () => ({
  BrowserWindow: {
    getAllWindows: () => [],
  },
}));

vi.mock("https", () => ({
  get: vi.fn(),
}));

import {
  compareSemver,
  makeUpdateChecker,
  type UpdateReleaseCache,
} from "./Updates";

const httpsGetMock = vi.mocked(httpsGet);

const releasePayload = (version: string) => ({
  tag_name: `v${version}`,
  html_url: `https://github.com/toommyliu/lucent/releases/tag/v${version}`,
});

const mockGitHubResponse = (options: {
  readonly statusCode: number;
  readonly statusMessage?: string;
  readonly headers?: Record<string, string>;
  readonly body?: unknown;
}): void => {
  httpsGetMock.mockImplementationOnce(((
    _url: string,
    _requestOptions: unknown,
    callback: unknown,
  ) => {
    const response = new EventEmitter() as IncomingMessage;
    response.statusCode = options.statusCode;
    response.statusMessage = options.statusMessage ?? "";
    response.headers = options.headers ?? {};

    queueMicrotask(() => {
      (callback as (response: IncomingMessage) => void)(response);
      if (options.body !== undefined) {
        response.emit(
          "data",
          typeof options.body === "string"
            ? options.body
            : JSON.stringify(options.body),
        );
      }
      response.emit("end");
    });

    const requestEmitter = new EventEmitter();
    const request = requestEmitter as ClientRequest;
    request.setTimeout = vi.fn(() => request) as ClientRequest["setTimeout"];
    request.destroy = vi.fn((error?: Error) => {
      if (error !== undefined) {
        queueMicrotask(() => request.emit("error", error));
      }
      return request;
    }) as ClientRequest["destroy"];
    return request;
  }) as never);
};

describe("update checker", () => {
  beforeEach(() => {
    vi.useRealTimers();
    httpsGetMock.mockReset();
  });

  it("compares v-prefixed semver tags", () => {
    expect(compareSemver("v1.2.4", "1.2.3")).toBeGreaterThan(0);
    expect(compareSemver("1.2.3", "v1.2.3")).toBe(0);
    expect(compareSemver("1.2.2", "v1.2.3")).toBeLessThan(0);
  });

  it.effect("reports an available release", () =>
    Effect.gen(function* () {
      mockGitHubResponse({
        statusCode: 200,
        headers: { etag: '"release-1.2.4"' },
        body: releasePayload("1.2.4"),
      });
      const checker = makeUpdateChecker({
        currentVersion: "1.2.3",
        isEnabled: () => Effect.succeed(true),
        now: () => new Date("2026-05-22T12:00:00.000Z"),
      });

      expect(yield* checker.checkNow()).toMatchObject({
        status: "available",
        currentVersion: "1.2.3",
        latestVersion: "1.2.4",
        checkedAt: "2026-05-22T12:00:00.000Z",
        release: {
          tagName: "v1.2.4",
        },
      });
    }),
  );

  it.effect("reports current when latest stable is not newer", () =>
    Effect.gen(function* () {
      mockGitHubResponse({
        statusCode: 200,
        body: releasePayload("1.2.3"),
      });
      const checker = makeUpdateChecker({
        currentVersion: "1.2.3",
        isEnabled: () => Effect.succeed(true),
      });

      expect(yield* checker.checkNow()).toMatchObject({
        status: "current",
        currentVersion: "1.2.3",
        latestVersion: "1.2.3",
      });
    }),
  );

  it.effect("does not check when preferences disable update checks", () =>
    Effect.gen(function* () {
      const checker = makeUpdateChecker({
        currentVersion: "1.2.3",
        isEnabled: () => Effect.succeed(false),
      });

      expect(yield* checker.checkNow()).toEqual({
        status: "idle",
        currentVersion: "1.2.3",
      });
      expect(httpsGetMock).not.toHaveBeenCalled();
    }),
  );

  it.effect(
    "allows forced checks even when preferences disable automatic checks",
    () =>
      Effect.gen(function* () {
        mockGitHubResponse({
          statusCode: 200,
          body: releasePayload("1.2.4"),
        });
        const checker = makeUpdateChecker({
          currentVersion: "1.2.3",
          isEnabled: () => Effect.succeed(false),
        });

        expect(yield* checker.checkNow({ force: true })).toMatchObject({
          status: "available",
          latestVersion: "1.2.4",
        });
      }),
  );

  it.effect(
    "sends cached etags and reuses the cached release on 304 responses",
    () =>
      Effect.gen(function* () {
        let cache: UpdateReleaseCache | null = {
          release: {
            version: "1.2.4",
            tagName: "v1.2.4",
            htmlUrl: "https://github.com/toommyliu/lucent/releases/tag/v1.2.4",
          },
          etag: '"release-1.2.4"',
        };
        mockGitHubResponse({
          statusCode: 304,
          headers: { etag: '"release-1.2.4b"' },
        });
        const saveCache = vi.fn((next: UpdateReleaseCache) => {
          cache = next;
          return Effect.void;
        });
        const checker = makeUpdateChecker({
          currentVersion: "1.2.3",
          isEnabled: () => Effect.succeed(true),
          now: () => new Date("2026-05-22T12:00:00.000Z"),
          loadCache: Effect.sync(() => cache),
          saveCache,
        });

        expect(yield* checker.checkNow()).toMatchObject({
          status: "available",
          latestVersion: "1.2.4",
          checkedAt: "2026-05-22T12:00:00.000Z",
        });
        expect(httpsGetMock).toHaveBeenCalledTimes(1);
        expect(httpsGetMock.mock.calls[0]?.[1]).toMatchObject({
          headers: {
            "If-None-Match": '"release-1.2.4"',
          },
        });
        expect(saveCache).toHaveBeenCalledWith({
          release: {
            version: "1.2.4",
            tagName: "v1.2.4",
            htmlUrl: "https://github.com/toommyliu/lucent/releases/tag/v1.2.4",
          },
          etag: '"release-1.2.4b"',
        });
        expect(cache?.etag).toBe('"release-1.2.4b"');
      }),
  );
});
