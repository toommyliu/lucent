import { describe, expect, it } from "vitest";

import { makeTabMenuController, type TabMenu } from "./tabMenu";

const harness = () => {
  const requests: {
    readonly open: boolean;
    readonly resolve: (open: boolean) => void;
    readonly reject: (cause: unknown) => void;
  }[] = [];
  const visible: TabMenu[] = [];
  const errors: unknown[] = [];
  const controller = makeTabMenuController({
    setNativeOpen: (open) =>
      new Promise<boolean>((resolve, reject) =>
        requests.push({ open, resolve, reject }),
      ),
    onMenuChange: (menu) => visible.push(menu),
    onError: (cause) => errors.push(cause),
  });
  return { controller, requests, visible, errors };
};

describe("tab menus", () => {
  it("waits for native expansion and ignores an open reply after a native dismissal", async () => {
    const { controller, requests, visible } = harness();
    controller.request("recent");
    expect(requests.map((request) => request.open)).toEqual([true]);
    expect(visible).toEqual([]);
    controller.nativeOpenChanged(false);
    requests[0]!.resolve(true);
    await Promise.resolve();
    expect(visible).toEqual([null]);
    controller.request("recent");
    requests[1]!.resolve(true);
    await Promise.resolve();
    expect(visible).toEqual([null, "recent"]);
  });

  it("keeps a newer open request when the previous close is acknowledged", async () => {
    const { controller, requests, visible } = harness();
    controller.request("overflow");
    requests[0]!.resolve(true);
    await Promise.resolve();
    controller.request(null);
    controller.request("recent");
    controller.nativeOpenChanged(false);
    requests[1]!.resolve(false);
    await Promise.resolve();
    expect(requests.map((request) => request.open)).toEqual([
      true,
      false,
      true,
    ]);
    requests[2]!.resolve(true);
    await Promise.resolve();
    expect(visible.at(-1)).toBe("recent");
  });

  it("restores the visible menu when its native close fails", async () => {
    const { controller, requests, visible, errors } = harness();
    controller.request("recent");
    requests[0]!.resolve(true);
    await Promise.resolve();
    controller.request(null);
    requests[1]!.reject(new Error("Native view unavailable"));
    await Promise.resolve();
    expect(visible).toEqual(["recent", null, "recent"]);
    expect(errors.map(String)).toEqual(["Error: Native view unavailable"]);
  });

  it("does not show a pending menu after disposal", async () => {
    const { controller, requests, visible } = harness();
    controller.request("overflow");
    requests[0]!.resolve(true);
    await Promise.resolve();
    controller.request("recent");
    controller.dispose();
    requests[1]!.resolve(true);
    await Promise.resolve();
    expect(visible).toEqual(["overflow"]);
  });
});
