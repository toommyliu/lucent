import { createWriteStream, promises as fs } from "fs";
import type { IncomingHttpHeaders, IncomingMessage } from "http";
import { pipeline, Transform } from "stream";

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { clientError, DesktopHttpClientError } from "./DesktopHttpError";
import { requestFollowingRedirects } from "./DesktopHttpRequest";

export {
  DesktopHttpClientError,
  crossOriginRedirectHeaders,
} from "./DesktopHttpError";

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

export interface DesktopHttpRequestOptions extends DesktopHttpGetOptions {
  readonly method?: string;
  readonly body?: Uint8Array;
  readonly redirect?: "follow" | "manual" | "error";
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

export interface DesktopHttpClientShape {
  readonly request: (
    options: DesktopHttpRequestOptions,
  ) => Effect.Effect<DesktopHttpResponse, DesktopHttpClientError>;
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

const responseLength = (response: IncomingMessage): number | undefined => {
  const value = Number(firstHttpHeader(response.headers, "content-length"));
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
};

const readResponse = (
  response: IncomingMessage,
  maxBytes: number | undefined,
  url: URL,
  head = false,
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
    response.on("aborted", () => fail(new Error("HTTP response was aborted.")));
    response.on("close", () => {
      if (!settled)
        fail(new Error("HTTP response ended before its body was complete."));
    });
    const contentLength = responseLength(response);
    if (
      !head &&
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
  request: (input) =>
    Effect.tryPromise({
      try: (signal) =>
        requestFollowingRedirects(
          {
            ...input,
            headers: input.headers ?? {},
            method: (input.method ?? "GET").toUpperCase(),
            maxRedirects: input.maxRedirects ?? 5,
            httpsOnly: false,
            signal,
          },
          async (response, url) => ({
            body: await readResponse(
              response,
              input.maxBytes,
              url,
              input.method?.toUpperCase() === "HEAD",
            ),
            headers: response.headers,
            statusCode: response.statusCode ?? 0,
            statusMessage: response.statusMessage ?? "",
            url: url.href,
          }),
        ),
      catch: (cause) => normalizeError(cause, input.url),
    }),
  get: (input) =>
    Effect.tryPromise({
      try: (signal) =>
        requestFollowingRedirects(
          {
            headers: input.headers ?? {},
            maxRedirects: input.maxRedirects ?? 0,
            socketTimeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
            signal,
            method: "GET",
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
      try: (signal) =>
        requestFollowingRedirects(
          {
            headers: input.headers ?? {},
            maxRedirects: input.maxRedirects ?? 0,
            socketTimeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
            signal,
            method: "GET",
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
