import type { BrowserWindow } from "electron";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "@effect/vitest";
import { makeGameWindowRequestBroker } from "./GameWindowRequestBroker";

const makeWindow = (
  send: (channel: string, message: unknown) => void = vi.fn(),
): BrowserWindow =>
  ({
    isDestroyed: () => false,
    webContents: {
      isDestroyed: () => false,
      send,
    },
  }) as unknown as BrowserWindow;

describe("GameWindowRequestBroker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves a known response and clears the timer", async () => {
    const send = vi.fn();
    const broker = makeGameWindowRequestBroker<string>();
    const promise = broker.request({
      target: makeWindow(send),
      requestChannel: "game:request",
      timeoutMs: 1_000,
      timeoutError: "timed out",
      sendError: "send failed",
      makeMessage: (requestId) => ({ requestId }),
    });

    const requestId = send.mock.calls[0]?.[1]?.requestId as string;

    expect(broker.pendingCount()).toBe(1);
    expect(broker.resolve(requestId, "ok")).toBe(true);
    expect(await promise).toBe("ok");
    expect(broker.pendingCount()).toBe(0);
  });

  it("returns false for unknown responses", () => {
    const broker = makeGameWindowRequestBroker<void>();

    expect(broker.resolve("missing", undefined)).toBe(false);
  });

  it("rejects on timeout and removes the pending request", async () => {
    const broker = makeGameWindowRequestBroker<void>();
    const promise = broker.request({
      target: makeWindow(),
      requestChannel: "game:request",
      timeoutMs: 1_000,
      timeoutError: "timed out",
      sendError: "send failed",
      makeMessage: (requestId) => ({ requestId }),
    });
    const assertion = expect(promise).rejects.toThrow("timed out");

    await vi.advanceTimersByTimeAsync(1_000);

    await assertion;
    expect(broker.pendingCount()).toBe(0);
  });

  it("supports timeout fallback values", async () => {
    const broker = makeGameWindowRequestBroker<readonly string[]>();
    const promise = broker.request({
      target: makeWindow(),
      requestChannel: "game:request",
      timeoutMs: 1_000,
      timeoutError: "timed out",
      sendError: "send failed",
      makeMessage: (requestId) => ({ requestId }),
      onTimeout: () => ["fallback"],
    });

    await vi.advanceTimersByTimeAsync(1_000);

    await expect(promise).resolves.toEqual(["fallback"]);
    expect(broker.pendingCount()).toBe(0);
  });

  it("cleans up when send throws", async () => {
    const broker = makeGameWindowRequestBroker<void>();
    const promise = broker.request({
      target: makeWindow(() => {
        throw new Error("boom");
      }),
      requestChannel: "game:request",
      timeoutMs: 1_000,
      timeoutError: "timed out",
      sendError: "send failed",
      makeMessage: (requestId) => ({ requestId }),
    });

    await expect(promise).rejects.toThrow("boom");
    expect(broker.pendingCount()).toBe(0);
  });

  it("rejects all pending requests on scope cleanup", async () => {
    const broker = makeGameWindowRequestBroker<void>();
    const first = broker.request({
      target: makeWindow(),
      requestChannel: "game:request",
      timeoutMs: 1_000,
      timeoutError: "timed out",
      sendError: "send failed",
      makeMessage: (requestId) => ({ requestId }),
    });
    const second = broker.request({
      target: makeWindow(),
      requestChannel: "game:request",
      timeoutMs: 1_000,
      timeoutError: "timed out",
      sendError: "send failed",
      makeMessage: (requestId) => ({ requestId }),
    });
    const firstAssertion = expect(first).rejects.toThrow("closed");
    const secondAssertion = expect(second).rejects.toThrow("closed");

    broker.rejectAll(new Error("closed"));

    await firstAssertion;
    await secondAssertion;
    expect(broker.pendingCount()).toBe(0);
  });
});
