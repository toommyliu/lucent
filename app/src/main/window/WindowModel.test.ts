import { describe, expect, it } from "@effect/vitest";
import { WindowIds } from "../../shared/windows";
import {
  appOpenKey,
  completeInFlightOpen,
  emptyWindowModelState,
  gameChildOpenKey,
  markGameWindowFocused,
  registerGameChildWindow,
  registerGameWindow,
  registerInFlightOpen,
  removeGameWindow,
  resolveGameWindowRef,
  resolvePreferredGameWindowRef,
  shouldHideOnClose,
  shouldQuitAfterGameWindowClosed,
} from "./WindowModel";

describe("WindowModel", () => {
  it("uses stable in-flight open keys", () => {
    expect(appOpenKey(WindowIds.AccountManager)).toBe("app:account-manager");
    expect(gameChildOpenKey(42, WindowIds.Packets)).toBe(
      "game-child:42:packets",
    );
  });

  it("tracks and clears in-flight opens immutably", () => {
    const opened = registerInFlightOpen(
      emptyWindowModelState(),
      appOpenKey(WindowIds.Settings),
    );
    expect(opened.inFlightOpenKeys.has("app:settings")).toBe(true);

    const completed = completeInFlightOpen(
      opened,
      appOpenKey(WindowIds.Settings),
    );
    expect(completed.inFlightOpenKeys.has("app:settings")).toBe(false);
    expect(opened.inFlightOpenKeys.has("app:settings")).toBe(true);
  });

  it("resolves child windows to their parent game window", () => {
    const game = registerGameWindow(emptyWindowModelState(), {
      context: { kind: "game", label: "Game" },
      windowId: 10,
    });
    const child = registerGameChildWindow(game.state, {
      context: {
        kind: "game-child",
        id: WindowIds.Packets,
        label: "Packets",
      },
      gameWindowId: game.ref.id,
      id: WindowIds.Packets,
      windowId: 11,
    });

    expect(resolveGameWindowRef(child.state, 11)).toEqual(game.ref);
  });

  it("removes child ownership when a game window is removed", () => {
    const game = registerGameWindow(emptyWindowModelState(), {
      context: { kind: "game", label: "Game" },
      windowId: 20,
    });
    const child = registerGameChildWindow(game.state, {
      context: {
        kind: "game-child",
        id: WindowIds.Follower,
        label: "Follower",
      },
      gameWindowId: game.ref.id,
      id: WindowIds.Follower,
      windowId: 21,
    });

    const removed = removeGameWindow(child.state, game.ref.id);
    expect(resolveGameWindowRef(removed, 21)).toBeUndefined();
    expect(removed.windowContexts.has(20)).toBe(false);
    expect(removed.windowContexts.has(21)).toBe(false);
  });

  it("prefers the sender game window, then last focused game window", () => {
    const first = registerGameWindow(emptyWindowModelState(), {
      context: { kind: "game", label: "Game" },
      windowId: 30,
    });
    const second = registerGameWindow(first.state, {
      context: { kind: "game", label: "Game" },
      windowId: 31,
    });
    const focused = markGameWindowFocused(second.state, second.ref.id);

    expect(
      resolvePreferredGameWindowRef(focused, {
        senderWindowId: first.ref.id,
        isUsable: () => true,
      }),
    ).toEqual(first.ref);
    expect(
      resolvePreferredGameWindowRef(focused, {
        isUsable: () => true,
      }),
    ).toEqual(second.ref);
  });

  it("keeps close and quit policy explicit", () => {
    const state = emptyWindowModelState();
    expect(
      shouldHideOnClose(state, {
        closeBehavior: "hide",
        windowId: 1,
      }),
    ).toBe(true);
    expect(
      shouldQuitAfterGameWindowClosed(state, {
        hasUsableGameWindow: false,
        isAccountManagerHidden: true,
      }),
    ).toBe(true);
  });
});
