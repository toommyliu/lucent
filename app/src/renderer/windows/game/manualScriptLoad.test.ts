import { describe, expect, it } from "@effect/vitest";
import type { ScriptExecutePayload } from "../../../shared/ipc";
import {
  confirmPendingManualScriptLoad,
  requestManualScriptLoad,
  scriptExecutePayloadName,
  type ManualScriptLoad,
  type PendingManualScriptLoad,
} from "./manualScriptLoad";

const payload = {
  source: "script.main = () => {};",
  path: "/scripts/new.js",
} satisfies ScriptExecutePayload;

describe("manual script load", () => {
  it("names script payloads predictably", () => {
    expect(scriptExecutePayloadName({ name: "custom.js" })).toBe("custom.js");
    expect(scriptExecutePayloadName({ path: "/scripts/path.js" })).toBe(
      "/scripts/path.js",
    );
    expect(scriptExecutePayloadName({})).toBe("script");
  });

  it("applies immediately when no script is running", () => {
    const applied: ManualScriptLoad[] = [];
    const pending: PendingManualScriptLoad[] = [];

    const result = requestManualScriptLoad(payload, {
      scriptRunning: () => false,
      currentScriptName: () => "old.js",
      applyLoadedScript: (script) => {
        applied.push(script);
      },
      setPendingManualScriptLoad: (nextPending) => {
        pending.push(nextPending);
      },
    });

    expect(result.status).toBe("loaded");
    expect(applied).toEqual([
      {
        source: payload.source,
        name: payload.path,
        path: payload.path,
      },
    ]);
    expect(pending).toEqual([]);
  });

  it("defers replacement while a script is running", () => {
    const applied: ManualScriptLoad[] = [];
    let pending: PendingManualScriptLoad | null = null;

    const result = requestManualScriptLoad(payload, {
      scriptRunning: () => true,
      currentScriptName: () => "  old.js  ",
      applyLoadedScript: (script) => {
        applied.push(script);
      },
      setPendingManualScriptLoad: (nextPending) => {
        pending = nextPending;
      },
    });

    expect(result.status).toBe("pending");
    expect(applied).toEqual([]);
    expect(pending).toEqual({
      currentScriptName: "old.js",
      nextScript: {
        source: payload.source,
        name: payload.path,
        path: payload.path,
      },
    });
  });

  it("stops the running script before applying confirmed replacement", async () => {
    const events: string[] = [];
    const pending = {
      currentScriptName: "old.js",
      nextScript: {
        source: "next",
        name: "new.js",
      },
    } satisfies PendingManualScriptLoad;

    await confirmPendingManualScriptLoad(pending, {
      stopRunningScript: async () => {
        events.push("stop");
      },
      applyLoadedScript: (script) => {
        events.push(`apply:${script.name}`);
      },
    });

    expect(events).toEqual(["stop", "apply:new.js"]);
  });

  it("does not apply replacement if stopping fails", async () => {
    const events: string[] = [];
    const pending = {
      currentScriptName: "old.js",
      nextScript: {
        source: "next",
        name: "new.js",
      },
    } satisfies PendingManualScriptLoad;

    await expect(
      confirmPendingManualScriptLoad(pending, {
        stopRunningScript: async () => {
          events.push("stop");
          throw new Error("stop failed");
        },
        applyLoadedScript: (script) => {
          events.push(`apply:${script.name}`);
        },
      }),
    ).rejects.toThrow("stop failed");

    expect(events).toEqual(["stop"]);
  });
});
