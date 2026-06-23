import { describe, expect, it } from "@effect/vitest";
import { vi } from "vitest";
import {
  formatConsoleArgument,
  installGameConsoleObservabilityBridge,
  makeConsoleObservabilityInput,
  nativeConsoleMessage,
  shouldCaptureConsoleArguments,
} from "./consoleObservabilityBridge";

describe("console observability bridge", () => {
  it("formats object arguments as useful sanitized text", () => {
    expect(shouldCaptureConsoleArguments(["plain", 1])).toBe(false);
    expect(shouldCaptureConsoleArguments([{ password: "secret" }])).toBe(true);
    expect(
      formatConsoleArgument({
        count: 1,
        password: "secret",
      }),
    ).toBe('{"count":1,"password":"[REDACTED]"}');
    expect(nativeConsoleMessage(["payload", { count: 1 }])).toBe(
      "payload [object Object]",
    );

    expect(
      makeConsoleObservabilityInput("log", ["payload", { count: 1 }]),
    ).toMatchObject({
      level: "info",
      source: "game",
      component: "game-window",
      message: 'payload {"count":1}',
      data: {
        kind: "console-message",
        capturedBy: "renderer-console",
        renderedArgs: ["payload", '{"count":1}'],
        nativeMessage: "payload [object Object]",
      },
    });
  });

  it("writes structured object logs while forwarding to the native console immediately", async () => {
    const writes: unknown[] = [];
    const originalLog = vi.fn();
    const consoleTarget = {
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      log: originalLog,
      warn: vi.fn(),
    };

    installGameConsoleObservabilityBridge(
      {
        write: async (record) => {
          writes.push(record);
        },
      },
      consoleTarget,
    );

    consoleTarget.log("payload", { count: 1 });

    expect(originalLog).toHaveBeenCalledWith("payload", { count: 1 });
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      message: 'payload {"count":1}',
    });
  });

  it("does not block native console output when observability write hangs", () => {
    const originalLog = vi.fn();
    const consoleTarget = {
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      log: originalLog,
      warn: vi.fn(),
    };

    installGameConsoleObservabilityBridge(
      {
        write: () => new Promise(() => undefined),
      },
      consoleTarget,
    );

    consoleTarget.log("payload", { count: 1 });

    expect(originalLog).toHaveBeenCalledWith("payload", { count: 1 });
  });
});
