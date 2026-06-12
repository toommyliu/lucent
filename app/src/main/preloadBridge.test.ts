import { describe, expect, it } from "vitest";
import type { AppBridge } from "../shared/ipc";
import type { PreloadWindowContext } from "../shared/window-startup-context";
import { WindowIds } from "../shared/windows";
import { selectScopedBridge, type PreloadBridgeParts } from "./preloadBridge";

const capability = <K extends keyof AppBridge>(name: K): AppBridge[K] =>
  ({ name }) as unknown as AppBridge[K];

const makeParts = (): PreloadBridgeParts => ({
  accounts: capability("accounts"),
  army: capability("army"),
  combatProfiles: capability("combatProfiles"),
  environment: capability("environment"),
  fastTravels: capability("fastTravels"),
  follower: capability("follower"),
  loaderGrabber: capability("loaderGrabber"),
  observability: capability("observability"),
  packets: capability("packets"),
  platform: capability("platform"),
  scripting: capability("scripting"),
  settings: capability("settings"),
  updates: capability("updates"),
  baseWindows: { open: async () => undefined },
  gameWindows: capability("windows"),
});

const keysOf = (context: PreloadWindowContext | null): readonly string[] =>
  Object.keys(selectScopedBridge(context, makeParts())).sort();

describe("preload bridge selector", () => {
  it("does not expose packet tools to the account manager", () => {
    expect(
      keysOf({
        kind: "app",
        id: WindowIds.AccountManager,
        label: "Account Manager",
      }),
    ).toEqual([
      "accounts",
      "observability",
      "platform",
      "scripting",
      "settings",
      "windows",
    ]);
  });

  it("does not expose account capabilities to fast travels", () => {
    expect(
      keysOf({
        kind: "game-child",
        id: WindowIds.FastTravels,
        label: "Fast travels",
      }),
    ).toEqual([
      "fastTravels",
      "observability",
      "platform",
      "settings",
      "windows",
    ]);
  });

  it("exposes the game-window capabilities used by the game renderer", () => {
    expect(keysOf({ kind: "game", label: "Game" })).toEqual([
      "accounts",
      "army",
      "combatProfiles",
      "environment",
      "fastTravels",
      "follower",
      "loaderGrabber",
      "observability",
      "packets",
      "platform",
      "scripting",
      "settings",
      "windows",
    ]);
  });

  it("falls back to the minimal base bridge for invalid startup context", () => {
    expect(keysOf(null)).toEqual([
      "observability",
      "platform",
      "settings",
      "windows",
    ]);
  });
});
