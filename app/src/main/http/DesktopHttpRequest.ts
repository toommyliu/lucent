import {
  request as httpRequest,
  type ClientRequest,
  type IncomingMessage,
} from "http";
import { request as httpsRequest } from "https";

import { clientError, crossOriginRedirectHeaders } from "./DesktopHttpError";

interface RequestOptions {
  readonly url: URL;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: Uint8Array;
  readonly maxRedirects: number;
  readonly redirect?: "follow" | "manual" | "error";
  readonly timeoutMs?: number;
  readonly socketTimeoutMs?: number;
  readonly httpsOnly?: boolean;
  readonly signal: AbortSignal;
}

const validateUrl = (url: URL, httpsOnly: boolean): void => {
  if (
    (url.protocol !== "https:" && (httpsOnly || url.protocol !== "http:")) ||
    url.username !== "" ||
    url.password !== ""
  ) {
    throw clientError(
      "invalid-url",
      `HTTP requests require an absolute ${httpsOnly ? "HTTPS" : "HTTP or HTTPS"} URL without embedded credentials.`,
      url,
    );
  }
};

/** Owns every redirect and body read under one deadline and abort signal. */
export const requestFollowingRedirects = <Value>(
  options: RequestOptions,
  consume: (response: IncomingMessage, url: URL) => Promise<Value>,
): Promise<Value> =>
  new Promise((resolve, reject) => {
    let outgoing: ClientRequest | undefined;
    let incoming: IncomingMessage | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    let currentUrl = options.url;

    const cleanup = () => {
      if (timer !== undefined) clearTimeout(timer);
      options.signal.removeEventListener("abort", onAbort);
    };
    const fail = (cause: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      incoming?.destroy();
      outgoing?.destroy();
      reject(cause);
    };
    const onAbort = () =>
      fail(clientError("aborted", "HTTP request was aborted.", currentUrl));
    const succeed = (value: Value) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };

    const send = (
      url: URL,
      method: string,
      headers: Readonly<Record<string, string>>,
      body: Uint8Array | undefined,
      redirects: number,
    ): void => {
      if (settled) return;
      currentUrl = url;
      try {
        validateUrl(url, options.httpsOnly ?? true);
        if (method === "CONNECT")
          throw clientError(
            "request-failed",
            "HTTP tunnels are not supported.",
            url,
          );
        const request = url.protocol === "https:" ? httpsRequest : httpRequest;
        const active = request(
          url,
          { headers: { ...headers }, method },
          (response) => {
            if (settled) {
              response.destroy();
              return;
            }
            incoming = response;
            const status = response.statusCode ?? 0;
            const location = response.headers.location;
            if (
              [301, 302, 303, 307, 308].includes(status) &&
              location !== undefined &&
              options.redirect !== "manual"
            ) {
              if (
                options.redirect === "error" ||
                redirects >= options.maxRedirects
              ) {
                fail(
                  clientError(
                    "redirect-failed",
                    options.redirect === "error"
                      ? "HTTP redirects are disabled."
                      : "HTTP request exceeded its redirect limit.",
                    url,
                  ),
                );
                return;
              }
              let nextUrl: URL;
              try {
                nextUrl = new URL(location, url);
                validateUrl(nextUrl, options.httpsOnly ?? true);
              } catch (cause) {
                fail(
                  clientError(
                    "redirect-failed",
                    "HTTP response contained an invalid redirect URL.",
                    url,
                    cause,
                  ),
                );
                return;
              }
              const nextHeaders =
                nextUrl.origin === url.origin
                  ? { ...headers }
                  : crossOriginRedirectHeaders(headers);
              const dropBody =
                ((status === 301 || status === 302) && method === "POST") ||
                (status === 303 && method !== "GET" && method !== "HEAD");
              if (dropBody) {
                for (const name of Object.keys(nextHeaders)) {
                  if (
                    [
                      "content-type",
                      "content-length",
                      "content-encoding",
                      "content-language",
                      "content-location",
                      "transfer-encoding",
                    ].includes(name.toLowerCase())
                  )
                    delete nextHeaders[name];
                }
              }
              // Discard redirect bodies before opening the next connection.
              incoming = undefined;
              outgoing = undefined;
              response.destroy();
              active.destroy();
              send(
                nextUrl,
                dropBody ? "GET" : method,
                nextHeaders,
                dropBody ? undefined : body,
                redirects + 1,
              );
              return;
            }
            try {
              void consume(response, url).then(succeed, fail);
            } catch (cause) {
              fail(cause);
            }
          },
        );
        outgoing = active;
        active.on("error", (cause) => {
          if (outgoing === active) fail(cause);
        });
        active.on("upgrade", (_response, socket) => {
          socket.destroy();
          fail(
            clientError(
              "request-failed",
              "HTTP protocol upgrades are not supported.",
              url,
            ),
          );
        });
        if (options.socketTimeoutMs !== undefined) {
          active.setTimeout(options.socketTimeoutMs, () => {
            if (outgoing === active)
              fail(
                clientError(
                  "request-failed",
                  `HTTP request timed out after ${options.socketTimeoutMs} milliseconds.`,
                  url,
                ),
              );
          });
        }
        // Electron 11 requires a Buffer. Keep the IPC view's bounds without copying.
        active.end(
          body === undefined
            ? undefined
            : Buffer.from(body.buffer, body.byteOffset, body.byteLength),
        );
      } catch (cause) {
        fail(cause);
      }
    };

    if (options.signal.aborted) {
      onAbort();
      return;
    }
    options.signal.addEventListener("abort", onAbort, { once: true });
    if (options.timeoutMs !== undefined) {
      const expire = () =>
        fail(
          clientError(
            "timeout",
            `HTTP request timed out after ${options.timeoutMs} milliseconds.`,
            currentUrl,
          ),
        );
      if (options.timeoutMs === 0) {
        expire();
        return;
      }
      timer = setTimeout(expire, options.timeoutMs);
    }
    send(options.url, options.method, options.headers, options.body, 0);
  });
