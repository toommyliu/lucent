import { describe, expect, it } from "@effect/vitest";

import { UpdatesIpc } from "../shared/ipc";
import { createInvoke, DesktopBridgeError } from "./preloadIpcClient";

describe("preload ipc client", () => {
  it("unwraps successful and failed invoke envelopes", async () => {
    const calls: Array<{
      readonly channel: string;
      readonly payload: unknown;
    }> = [];
    const invoke = createInvoke(async (channel, payload) => {
      calls.push({ channel, payload });
      return { ok: true, value: true };
    });

    await expect(invoke(UpdatesIpc.openReleasePage, undefined)).resolves.toBe(
      true,
    );
    expect(calls).toEqual([
      { channel: UpdatesIpc.openReleasePage.channel, payload: undefined },
    ]);

    const failingInvoke = createInvoke(async () => ({
      ok: false,
      error: {
        channel: UpdatesIpc.openReleasePage.channel,
        code: "NO_RELEASE",
        message: "No release URL is available.",
      },
    }));

    await expect(
      failingInvoke(UpdatesIpc.openReleasePage, undefined),
    ).rejects.toBeInstanceOf(DesktopBridgeError);
    await expect(
      failingInvoke(UpdatesIpc.openReleasePage, undefined),
    ).rejects.toMatchObject({
      code: "NO_RELEASE",
      message: "No release URL is available.",
    });
  });
});
