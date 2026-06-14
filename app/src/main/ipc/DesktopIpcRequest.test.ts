import { describe, expect, it } from "@effect/vitest";
import { WindowIds } from "../../shared/windows";
import {
  hasDesktopIpcCapability,
  type DesktopIpcCapability,
} from "./DesktopIpcRequest";
import type { WindowStartupContext } from "../window/WindowService";

const capabilities = (
  context: WindowStartupContext,
): Record<DesktopIpcCapability, boolean> => ({
  "account-manager": hasDesktopIpcCapability(context, "account-manager"),
  "game-window": hasDesktopIpcCapability(context, "game-window"),
  scripting: hasDesktopIpcCapability(context, "scripting"),
});

describe("desktop IPC capability policy", () => {
  it("allows account manager access only from the account manager window", () => {
    expect(
      capabilities({
        kind: "app",
        id: WindowIds.AccountManager,
        label: "Account Manager",
      }),
    ).toEqual({
      "account-manager": true,
      "game-window": false,
      scripting: true,
    });

    expect(
      capabilities({
        kind: "app",
        id: WindowIds.Settings,
        label: "Settings",
      }),
    ).toEqual({
      "account-manager": false,
      "game-window": false,
      scripting: false,
    });
  });

  it("allows game-only access only from game windows", () => {
    expect(capabilities({ kind: "game", label: "Game" })).toEqual({
      "account-manager": false,
      "game-window": true,
      scripting: true,
    });

    expect(
      capabilities({
        kind: "game-child",
        id: WindowIds.Packets,
        label: "Packets",
      }),
    ).toEqual({
      "account-manager": false,
      "game-window": false,
      scripting: false,
    });
  });
});
