// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppBridge } from "../../shared/ipc";
import {
  DEFAULT_APPEARANCE,
  DEFAULT_HOTKEYS,
  DEFAULT_PREFERENCES,
} from "../../shared/settings";
import { mountWindow } from "./mount";

vi.mock("solid-js/web", () => ({
  render: vi.fn((app: () => unknown, root: HTMLElement) => {
    root.textContent = String(app());
    return vi.fn();
  }),
}));

const settings = {
  preferences: DEFAULT_PREFERENCES,
  appearance: DEFAULT_APPEARANCE,
  hotkeys: DEFAULT_HOTKEYS,
};

const makeBridge = () => {
  const write = vi.fn(() => Promise.resolve());
  const bridge = {
    observability: {
      write,
      snapshot: vi.fn(),
    },
    platform: { os: "mac" },
    settings: {
      initial: settings,
      get: vi.fn(() => new Promise(() => undefined)),
      onChanged: vi.fn(() => () => undefined),
    },
  } as unknown as AppBridge;

  return { bridge, write };
};

describe("mountWindow", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
    document.documentElement.removeAttribute("data-ready");
    const { bridge } = makeBridge();
    Object.defineProperty(window, "ipc", {
      configurable: true,
      value: bridge,
    });
  });

  it("renders immediately with the initial settings snapshot", () => {
    mountWindow(({ initialSettings }) => {
      expect(initialSettings).toBe(settings);
      return "mounted";
    });

    expect(document.getElementById("root")?.textContent).toBe("mounted");
    expect(document.documentElement.dataset["ready"]).toBe("true");
  });

  it("records renderer mount timing without delaying render", () => {
    const { bridge, write } = makeBridge();
    Object.defineProperty(window, "ipc", {
      configurable: true,
      value: bridge,
    });

    mountWindow(() => "mounted");

    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "renderer-startup",
        message: "Renderer mount completed",
        source: "renderer",
        data: expect.objectContaining({
          initialSettingsPresent: true,
          mounted: true,
        }),
      }),
    );
  });
});
