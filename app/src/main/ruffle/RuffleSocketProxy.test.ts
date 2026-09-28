import { once } from "events";
import { createServer, type TcpNetConnectOpts } from "net";

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
} from "@effect/vitest";
import { vi } from "vitest";
import { WebSocket, type WebSocketServer } from "ws";

const relayTest = vi.hoisted(() => ({
  servers: [] as WebSocketServer[],
  targetPort: 0,
  connect: vi.fn(),
}));

vi.mock("ws", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ws")>();
  return {
    ...actual,
    WebSocketServer: class extends actual.WebSocketServer {
      constructor(
        options: ConstructorParameters<typeof actual.WebSocketServer>[0],
      ) {
        super(options);
        relayTest.servers.push(this);
      }
    },
  };
});

vi.mock("net", async (importOriginal) => {
  const actual = await importOriginal<typeof import("net")>();
  return {
    ...actual,
    createConnection: (options: TcpNetConnectOpts) => {
      relayTest.connect(options);
      return actual.createConnection({
        ...options,
        host: "127.0.0.1",
        port: relayTest.targetPort,
      });
    },
  };
});

import { ruffleSocketProxyUrl } from "./RuffleSocketProxy";

const echo = createServer((socket) => socket.pipe(socket));
const clients = new Set<WebSocket>();
let proxyUrl: string;

const connect = (url: string): WebSocket => {
  const client = new WebSocket(url, { origin: "https://untrusted.example" });
  client.on("error", () => {});
  clients.add(client);
  return client;
};

beforeAll(async () => {
  echo.listen(0, "127.0.0.1");
  await once(echo, "listening");
  const address = echo.address();
  if (address === null || typeof address === "string")
    throw new Error("No TCP address");
  relayTest.targetPort = address.port;
  proxyUrl = await ruffleSocketProxyUrl();
});

afterEach(() => {
  for (const client of clients) client.terminate();
  clients.clear();
  relayTest.connect.mockClear();
});

afterAll(async () => {
  await Promise.all(
    relayTest.servers.map(
      (server) =>
        new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        ),
    ),
  );
  await new Promise<void>((resolve, reject) =>
    echo.close((error) => (error ? reject(error) : resolve())),
  );
});

describe("Ruffle socket relay", () => {
  it.each(["/", "/wrong-token"])(
    "rejects %s before opening a TCP connection",
    async (pathname) => {
      const url = new URL(proxyUrl);
      url.pathname = pathname;
      url.search = "?host=game.aq.com&port=5588";
      const client = connect(url.toString());
      const [, response] = await once(client, "unexpected-response");
      expect(response.statusCode).toBe(401);
      response.resume();
      expect(relayTest.connect).not.toHaveBeenCalled();
    },
  );

  it("relays binary data when the client has the session token", async () => {
    const client = connect(`${proxyUrl}?host=game.aq.com&port=5588`);
    await once(client, "open");
    const response = once(client, "message");
    client.send(Buffer.from([0, 1, 2, 255]));
    const [data, binary] = await response;
    expect(data).toEqual(Buffer.from([0, 1, 2, 255]));
    expect(binary).toBe(true);
    expect(relayTest.connect).toHaveBeenCalledWith({
      host: "game.aq.com",
      port: 5588,
      noDelay: true,
    });
  });

  it.each(["0", "-1", "65536", "1.5", "Infinity"])(
    "rejects invalid destination port %s",
    async (port) => {
      const client = connect(`${proxyUrl}?host=game.aq.com&port=${port}`);
      const [code] = await once(client, "close");
      expect(code).toBe(1008);
      expect(relayTest.connect).not.toHaveBeenCalled();
    },
  );
});
