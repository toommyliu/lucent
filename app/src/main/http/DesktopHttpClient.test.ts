import { EventEmitter } from "events";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import type { IncomingMessage } from "http";
import { request as httpsRequest } from "https";
import { tmpdir } from "os";
import { join } from "path";
import { Readable } from "stream";

import { describe, expect, it } from "@effect/vitest";
import { afterEach, vi } from "vitest";
import * as Effect from "effect/Effect";

import {
  crossOriginRedirectHeaders,
  DesktopHttpClientError,
  firstHttpHeader,
  makeDesktopHttpClient,
} from "./DesktopHttpClient";

vi.mock("https", () => ({
  request: vi.fn(),
}));

interface TestRequest extends EventEmitter {
  destroy: (cause?: Error) => void;
  end: () => void;
  setTimeout: (milliseconds: number, listener: () => void) => TestRequest;
}

interface RequestMock {
  mockImplementationOnce: (
    implementation: (...args: readonly unknown[]) => TestRequest,
  ) => void;
}

const requestMock = httpsRequest as unknown as RequestMock;
const tempDirs = new Set<string>();

const makeResponse = (options: {
  readonly body?: string;
  readonly headers?: Record<string, string>;
  readonly statusCode?: number;
  readonly statusMessage?: string;
}): IncomingMessage => {
  const response = Readable.from([options.body ?? ""]) as IncomingMessage;
  Object.assign(response, {
    headers: options.headers ?? {},
    statusCode: options.statusCode ?? 200,
    statusMessage: options.statusMessage ?? "OK",
  });
  return response;
};

const queueResponse = (response: IncomingMessage): void => {
  requestMock.mockImplementationOnce((...args) => {
    const callback = args.find(
      (value): value is (value: IncomingMessage) => void =>
        typeof value === "function",
    );
    if (callback === undefined) {
      throw new Error("HTTPS test request expected a response callback.");
    }

    const outgoing = new EventEmitter() as TestRequest;
    outgoing.setTimeout = () => outgoing;
    outgoing.destroy = (cause) => {
      if (cause !== undefined) outgoing.emit("error", cause);
    };
    outgoing.end = () => {
      process.nextTick(() => callback(response));
    };
    return outgoing;
  });
};

afterEach(async () => {
  vi.clearAllMocks();
  await Promise.all(
    [...tempDirs].map((path) => rm(path, { force: true, recursive: true })),
  );
  tempDirs.clear();
});

describe("DesktopHttpClient", () => {
  it("normalizes response headers and strips cross-origin credentials", () => {
    expect(firstHttpHeader({ "set-cookie": ["", "value"] }, "Set-Cookie")).toBe(
      "value",
    );
    expect(
      crossOriginRedirectHeaders({
        Accept: "application/json",
        Authorization: "Bearer secret",
        Cookie: "session=secret",
        Host: "api.github.com",
        "Proxy-Authorization": "Basic secret",
        "User-Agent": "Lucent/test",
      }),
    ).toEqual({
      Accept: "application/json",
      "User-Agent": "Lucent/test",
    });
  });

  it.effect("rejects buffered responses beyond their byte limit", () =>
    Effect.gen(function* () {
      queueResponse(
        makeResponse({
          body: "oversized",
          headers: { "content-length": "9" },
        }),
      );

      const error = yield* makeDesktopHttpClient()
        .get({
          maxBytes: 8,
          url: new URL("https://example.com/value"),
        })
        .pipe(Effect.flip);

      expect(error).toBeInstanceOf(DesktopHttpClientError);
      expect(error.kind).toBe("response-too-large");
    }),
  );

  it.effect("accepts buffered responses when no byte limit is requested", () =>
    Effect.gen(function* () {
      queueResponse(
        makeResponse({
          body: "unbounded",
          headers: { "content-length": "9" },
        }),
      );

      const response = yield* makeDesktopHttpClient().get({
        url: new URL("https://example.com/value"),
      });

      expect(response.body.toString("utf8")).toBe("unbounded");
    }),
  );

  it.effect("does not delete a pre-existing download target", () =>
    Effect.gen(function* () {
      const directory = yield* Effect.promise(async () => {
        const path = await mkdtemp(join(tmpdir(), "lucent-http-"));
        tempDirs.add(path);
        return path;
      });
      const targetPath = join(directory, "archive.tar.gz");
      yield* Effect.promise(() => writeFile(targetPath, "keep", "utf8"));
      queueResponse(makeResponse({ body: "replacement" }));

      yield* makeDesktopHttpClient()
        .download({
          maxBytes: 1024,
          targetPath,
          url: new URL("https://example.com/archive"),
        })
        .pipe(Effect.flip);

      expect(yield* Effect.promise(() => readFile(targetPath, "utf8"))).toBe(
        "keep",
      );
    }),
  );
});
