import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { TestClock } from "effect/testing";

import {
  DesktopHttpClientError,
  type DesktopHttpClientShape,
  type DesktopHttpResponse,
} from "../http/DesktopHttpClient";
import {
  isGitHubRateLimitResponse,
  makeGitHubApiClient,
  retryAtFromGitHubHeaders,
} from "./GitHubApiClient";

const API_URL = new URL("https://api.github.com/repos/example/tools");

const response = (options: {
  readonly body?: string;
  readonly headers?: Record<string, string>;
  readonly statusCode: number;
  readonly statusMessage?: string;
}): DesktopHttpResponse => ({
  body: Buffer.from(options.body ?? "", "utf8"),
  headers: options.headers ?? {},
  statusCode: options.statusCode,
  statusMessage: options.statusMessage ?? "",
  url: API_URL.href,
});

const makeHttpClient = (
  responses: DesktopHttpResponse[],
  requestCount: { value: number },
): DesktopHttpClientShape => ({
  get: (options) =>
    Effect.gen(function* () {
      requestCount.value += 1;
      const next = responses.shift();
      if (next === undefined) {
        return yield* new DesktopHttpClientError({
          kind: "request-failed",
          detail: "No test response was queued.",
          url: options.url.href,
        });
      }
      return next;
    }),
  download: (options) =>
    Effect.fail(
      new DesktopHttpClientError({
        kind: "request-failed",
        detail: "Downloads are not used by this test client.",
        url: options.url.href,
      }),
    ),
});

describe("GitHubApiClient", () => {
  it("derives cooldowns from Retry-After and primary reset headers", () => {
    const now = Date.parse("2026-08-01T00:00:00.000Z");
    expect(retryAtFromGitHubHeaders({ "retry-after": "30" }, now)).toBe(
      now + 30_000,
    );
    expect(
      retryAtFromGitHubHeaders(
        {
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": String(now / 1000 + 45),
        },
        now,
      ),
    ).toBe(now + 45_000);
  });

  it("distinguishes rate limits from ordinary permission failures", () => {
    expect(
      isGitHubRateLimitResponse({
        body: Buffer.from("secondary rate limit"),
        headers: {},
        statusCode: 403,
      }),
    ).toBe(true);
    expect(
      isGitHubRateLimitResponse({
        body: Buffer.from("organization policy denied access"),
        headers: {},
        statusCode: 403,
      }),
    ).toBe(false);
    expect(
      isGitHubRateLimitResponse({
        body: Buffer.alloc(0),
        headers: {},
        statusCode: 429,
      }),
    ).toBe(true);
  });

  it.effect("retries unavailable responses with a bounded backoff", () =>
    Effect.gen(function* () {
      const requestCount = { value: 0 };
      const client = makeGitHubApiClient(
        makeHttpClient(
          [
            response({ statusCode: 503 }),
            response({ statusCode: 502 }),
            response({ statusCode: 200 }),
          ],
          requestCount,
        ),
        "Lucent/test",
      );
      const fiber = yield* Effect.forkChild(
        client.get({ attempts: 3, url: API_URL }),
      );

      yield* TestClock.adjust("10 seconds");
      const result = yield* Fiber.join(fiber);

      expect(result.statusCode).toBe(200);
      expect(requestCount.value).toBe(3);
    }),
  );

  it.effect("fails permission errors without retrying", () =>
    Effect.gen(function* () {
      const requestCount = { value: 0 };
      const client = makeGitHubApiClient(
        makeHttpClient(
          [response({ body: "organization policy denied", statusCode: 403 })],
          requestCount,
        ),
        "Lucent/test",
      );

      const error = yield* client
        .get({ attempts: 3, url: API_URL })
        .pipe(Effect.flip);

      expect(error.kind).toBe("permission");
      expect(requestCount.value).toBe(1);
    }),
  );

  it.effect("does not accept not-modified archive responses", () =>
    Effect.gen(function* () {
      const requestCount = { value: 0 };
      const base = makeHttpClient([], requestCount);
      const client = makeGitHubApiClient(
        {
          ...base,
          download: () => Effect.succeed(response({ statusCode: 304 })),
        },
        "Lucent/test",
      );

      const error = yield* client
        .download({
          attempts: 1,
          maxBytes: 1024,
          targetPath: "/tmp/lucent-unused-test-archive",
          url: API_URL,
        })
        .pipe(Effect.flip);

      expect(error.kind).toBe("unexpected-response");
      expect(error.statusCode).toBe(304);
    }),
  );

  it.effect("shares public rate-limit cooldowns across requests", () =>
    Effect.gen(function* () {
      const requestCount = { value: 0 };
      const client = makeGitHubApiClient(
        makeHttpClient(
          [response({ headers: { "retry-after": "30" }, statusCode: 429 })],
          requestCount,
        ),
        "Lucent/test",
      );

      const first = yield* client
        .get({ attempts: 3, url: API_URL })
        .pipe(Effect.flip);
      const second = yield* client
        .get({ attempts: 3, url: API_URL })
        .pipe(Effect.flip);

      expect(first.kind).toBe("rate-limited");
      expect(second.kind).toBe("rate-limited");
      expect(second.retryAt).toBe(first.retryAt);
      expect(requestCount.value).toBe(1);
    }),
  );
});
