import { randomBytes } from "crypto";
import type { IncomingMessage } from "http";
import { createConnection } from "net";

import { WebSocketServer, type WebSocket } from "ws";

interface RelayTarget {
  readonly host: string;
  readonly port: number;
}

const ARTIX_HOSTNAME = /(^|\.)(aq\.com|aqworlds\.com|artix\.com)$/i;
const RELAY_HOST = "127.0.0.1";
const POLICY_VIOLATION = 1008;
const INTERNAL_ERROR = 1011;
const MAX_CLOSE_REASON_LENGTH = 120;

let started: Promise<string> | undefined;

const requestUrl = (request: IncomingMessage): URL =>
  new URL(request.url ?? "/", "http://localhost");

const hasToken = (request: IncomingMessage, token: string): boolean => {
  try {
    return requestUrl(request).pathname === `/${token}`;
  } catch {
    return false;
  }
};

const isTcpPort = (port: number): boolean =>
  Number.isInteger(port) && port >= 1 && port <= 65_535;

const parseRelayTarget = (request: IncomingMessage): RelayTarget | null => {
  const params = requestUrl(request).searchParams;
  const host = params.get("host");
  const port = Number(params.get("port"));
  if (host === null || !ARTIX_HOSTNAME.test(host) || !isTcpPort(port))
    return null;
  return { host, port };
};

const relay = (ws: WebSocket, target: RelayTarget): void => {
  const tcp = createConnection({ ...target, noDelay: true });
  tcp.on("data", (data) => {
    if (ws.readyState === ws.OPEN) ws.send(data);
  });
  tcp.on("close", () => ws.close());
  tcp.on("error", (error) =>
    ws.close(INTERNAL_ERROR, error.message.slice(0, MAX_CLOSE_REASON_LENGTH)),
  );
  ws.on("message", (data: Buffer) => tcp.write(data));
  ws.on("close", () => tcp.destroy());
  ws.on("error", () => tcp.destroy());
};

const startRelay = (): Promise<string> =>
  new Promise((resolve, reject) => {
    const token = randomBytes(32).toString("hex");
    const server = new WebSocketServer({
      host: RELAY_HOST,
      port: 0,
      perMessageDeflate: false,
      verifyClient: ({ req }: { req: IncomingMessage }) => hasToken(req, token),
    });
    server.once("error", reject);
    server.once("listening", () => {
      const address = server.address();
      const port =
        typeof address === "object" && address !== null ? address.port : 0;
      resolve(`ws://${RELAY_HOST}:${port}/${token}`);
    });
    server.on("connection", (ws, request) => {
      const target = parseRelayTarget(request);
      if (target === null) {
        ws.close(POLICY_VIOLATION, "host not allowed");
        return;
      }
      relay(ws, target);
    });
  });

export const ruffleSocketProxyUrl = (): Promise<string> => {
  started ??= startRelay();
  return started;
};
