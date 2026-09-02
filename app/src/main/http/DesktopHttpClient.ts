import { createWriteStream, promises as fs } from "fs";
import type { IncomingHttpHeaders, IncomingMessage } from "http";
import { request } from "https";
import { pipeline, Transform } from "stream";

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_ERROR_RESPONSE_MAX_BYTES = 1024 * 1024;

export interface DesktopHttpResponse {
  readonly body: Buffer;
  readonly headers: IncomingHttpHeaders;
  readonly statusCode: number;
  readonly statusMessage: string;
  readonly url: string;
}

export interface DesktopHttpGetOptions {
  readonly headers?: Readonly<Record<string, string>>;
  readonly maxBytes?: number;
  readonly maxRedirects?: number;
  readonly timeoutMs?: number;
  readonly url: URL;
}

export interface DesktopHttpDownloadOptions {
  readonly errorResponseMaxBytes?: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly maxBytes: number;
  readonly maxRedirects?: number;
  readonly targetPath: string;
  readonly timeoutMs?: number;
  readonly url: URL;
}

export class DesktopHttpClientError extends Schema.TaggedError<DesktopHttpClientError>()(
  "DesktopHttpClientError",
  {
    kind: Schema.Literals([
      "invalid-url",
      "redirect-failed",
      "request-failed",
      "response-too-large",
    ]),
    detail: Schema.String,
    url: Schema.String,
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {
  override get message(): string {
    return this.detail;
  }
}

export interface DesktopHttpClientShape {
  readonly download: (
    options: DesktopHttpDownloadOptions,
  ) => Effect.Effect<DesktopHttpResponse, DesktopHttpClientError>;
  readonly get: (
    options: DesktopHttpGetOptions,
  ) => Effect.Effect<DesktopHttpResponse, DesktopHttpClientError>;
}

export class DesktopHttpClient extends Context.Service<
  DesktopHttpClient,
  DesktopHttpClientShape
>()("lucent/desktop/http/DesktopHttpClient") {}

export const firstHttpHeader = (
  headers: IncomingHttpHeaders,
  name: string,
): string | undefined => {
  const value = headers[name.toLowerCase()];
  if (Array.isArray(value)) return value.find((entry) => entry.trim() !== "");
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : undefined;
};

const CROSS_ORIGIN_SENSITIVE_HEADERS = new Set([
  "authorization",
  "cookie",
  "host",
  "proxy-authorization",
]);

/** Prevents credentials and origin-bound headers from following a redirect. */
export const crossOriginRedirectHeaders = (
  headers: Readonly<Record<string, string>>,
): Record<string, string> =>
  Object.fromEntries(
    Object.entries(headers).filter(
      ([name]) => !CROSS_ORIGIN_SENSITIVE_HEADERS.has(name.toLowerCase()),
    ),
  );

const clientError = (
  kind: DesktopHttpClientError["kind"],
  detail: string,
  url: URL,
  cause?: unknown,
): DesktopHttpClientError =>
  new DesktopHttpClientError({
    kind,
    detail,
    url: url.href,
    ...(cause === undefined ? {} : { cause }),
  });

const validateRequestUrl = (url: URL): void => {
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "") {
    throw clientError(
      "invalid-url",
      "Desktop HTTP requests require an HTTPS URL without embedded credentials.",
      url,
    );
  }
};

const responseLength = (response: IncomingMessage): number | undefined => {
  const value = Number(firstHttpHeader(response.headers, "content-length"));
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
};

const readResponse = (
  response: IncomingMessage,
  maxBytes: number | undefined,
  url: URL,
): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    let settled = false;
    const fail = (cause: unknown): void => {
      if (settled) return;
      settled = true;
      response.destroy();
      reject(cause);
    };

    response.on("error", fail);
    const contentLength = responseLength(response);
    if (
      maxBytes !== undefined &&
      contentLength !== undefined &&
      contentLength > maxBytes
    ) {
      fail(
        clientError(
          "response-too-large",
          `HTTP response exceeds the ${maxBytes} byte limit.`,
          url,
        ),
      );
      return;
    }

    const chunks: Buffer[] = [];
    let bytes = 0;
    response.on("data", (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.byteLength;
      if (maxBytes !== undefined && bytes > maxBytes) {
        fail(
          clientError(
            "response-too-large",
            `HTTP response exceeds the ${maxBytes} byte limit.`,
            url,
          ),
        );
        return;
      }
      chunks.push(buffer);
    });
    response.on("end", () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks, bytes));
    });
  });

const streamResponse = (
  response: IncomingMessage,
  targetPath: string,
  maxBytes: number,
  url: URL,
): Promise<void> => {
  const contentLength = responseLength(response);
  if (contentLength !== undefined && contentLength > maxBytes) {
    response.destroy();
    return Promise.reject(
      clientError(
        "response-too-large",
        `HTTP download exceeds the ${maxBytes} byte limit.`,
        url,
      ),
    );
  }

  return new Promise((resolve, reject) => {
    let bytes = 0;
    let targetCreated = false;
    const limiter = new Transform({
      transform(chunk: Buffer | string, _encoding, callback) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += buffer.byteLength;
        callback(
          bytes > maxBytes
            ? clientError(
                "response-too-large",
                `HTTP download exceeds the ${maxBytes} byte limit.`,
                url,
              )
            : null,
          buffer,
        );
      },
    });
    const output = createWriteStream(targetPath, { flags: "wx", mode: 0o600 });
    output.once("open", () => {
      targetCreated = true;
    });
    pipeline(response, limiter, output, (cause) => {
      if (cause === undefined || cause === null) {
        resolve();
        return;
      }
      if (!targetCreated) {
        reject(cause);
        return;
      }
      void fs.unlink(targetPath).then(
        () => reject(cause),
        () => reject(cause),
      );
    });
  });
};

interface RequestOptions {
  readonly headers: Readonly<Record<string, string>>;
  readonly maxRedirects: number;
  readonly timeoutMs: number;
  readonly url: URL;
}

const requestFollowingRedirects = <Value>(
  options: RequestOptions,
  consume: (response: IncomingMessage, url: URL) => Promise<Value>,
  redirectCount = 0,
): Promise<Value> => {
  try {
    validateRequestUrl(options.url);
  } catch (cause) {
    return Promise.reject(cause);
  }

  return new Promise((resolve, reject) => {
    const outgoing = request(
      options.url,
      { headers: { ...options.headers }, method: "GET" },
      (response) => {
        const statusCode = response.statusCode ?? 0;
        const location = response.headers.location;
        if (statusCode >= 300 && statusCode < 400 && location !== undefined) {
          response.resume();
          if (redirectCount >= options.maxRedirects) {
            reject(
              clientError(
                "redirect-failed",
                "HTTP request exceeded its redirect limit.",
                options.url,
              ),
            );
            return;
          }

          let nextUrl: URL;
          try {
            nextUrl = new URL(location, options.url);
            validateRequestUrl(nextUrl);
          } catch (cause) {
            reject(
              cause instanceof DesktopHttpClientError
                ? cause
                : clientError(
                    "redirect-failed",
                    "HTTP response contained an invalid redirect URL.",
                    options.url,
                    cause,
                  ),
            );
            return;
          }
          const headers =
            nextUrl.origin === options.url.origin
              ? options.headers
              : crossOriginRedirectHeaders(options.headers);
          void requestFollowingRedirects(
            { ...options, headers, url: nextUrl },
            consume,
            redirectCount + 1,
          ).then(resolve, reject);
          return;
        }

        void Promise.resolve()
          .then(() => consume(response, options.url))
          .then(resolve, reject);
      },
    );
    outgoing.setTimeout(options.timeoutMs, () => {
      outgoing.destroy(
        clientError(
          "request-failed",
          `HTTP request timed out after ${options.timeoutMs} milliseconds.`,
          options.url,
        ),
      );
    });
    outgoing.on("error", reject);
    outgoing.end();
  });
};

const normalizeError = (cause: unknown, url: URL): DesktopHttpClientError =>
  cause instanceof DesktopHttpClientError
    ? cause
    : clientError(
        "request-failed",
        cause instanceof Error && cause.message.trim() !== ""
          ? cause.message
          : "HTTP request failed.",
        url,
        cause,
      );

export const makeDesktopHttpClient = (): DesktopHttpClientShape => ({
  get: (input) =>
    Effect.tryPromise({
      try: () =>
        requestFollowingRedirects(
          {
            headers: input.headers ?? {},
            maxRedirects: input.maxRedirects ?? 0,
            timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
            url: input.url,
          },
          async (response, url) => ({
            body: await readResponse(response, input.maxBytes, url),
            headers: response.headers,
            statusCode: response.statusCode ?? 0,
            statusMessage: response.statusMessage ?? "",
            url: url.href,
          }),
        ),
      catch: (cause) => normalizeError(cause, input.url),
    }),
  download: (input) =>
    Effect.tryPromise({
      try: () =>
        requestFollowingRedirects(
          {
            headers: input.headers ?? {},
            maxRedirects: input.maxRedirects ?? 0,
            timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
            url: input.url,
          },
          async (response, url) => {
            const statusCode = response.statusCode ?? 0;
            if (statusCode >= 200 && statusCode < 300) {
              await streamResponse(
                response,
                input.targetPath,
                input.maxBytes,
                url,
              );
              return {
                body: Buffer.alloc(0),
                headers: response.headers,
                statusCode,
                statusMessage: response.statusMessage ?? "",
                url: url.href,
              };
            }

            return {
              body: await readResponse(
                response,
                input.errorResponseMaxBytes ?? DEFAULT_ERROR_RESPONSE_MAX_BYTES,
                url,
              ),
              headers: response.headers,
              statusCode,
              statusMessage: response.statusMessage ?? "",
              url: url.href,
            };
          },
        ),
      catch: (cause) => normalizeError(cause, input.url),
    }),
});

export const layer = Layer.succeed(
  DesktopHttpClient,
  DesktopHttpClient.of(makeDesktopHttpClient()),
);
