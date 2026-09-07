import { afterEach, describe, expect, it, vi } from "@effect/vitest";
import type { AccountGameServer } from "@lucent/core/accounts";

import {
  readStoredAccountLoginServerPreference,
  resolveAccountLoginServerPreference,
  writeStoredAccountLoginServerPreference,
} from "./loginServerPreference";

const storageKey = "lucent.account-manager.login-server";

const stubLocalStorage = (initialValue?: string): Map<string, string> => {
  const values = new Map<string, string>();
  if (initialValue !== undefined) {
    values.set(storageKey, initialValue);
  }
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    },
  });
  return values;
};

const gameServer = (
  name: string,
  overrides: Partial<AccountGameServer> = {},
): AccountGameServer => ({
  name,
  language: "en",
  online: true,
  upgrade: false,
  playerCount: 100,
  maxPlayers: 1_000,
  ...overrides,
});

afterEach(() => vi.unstubAllGlobals());

describe("account login server preference", () => {
  it.each([{ type: "none" }, { type: "server", name: "Artix" }] as const)(
    "round-trips a $type preference through storage",
    (preference) => {
      stubLocalStorage();
      writeStoredAccountLoginServerPreference(preference);
      expect(readStoredAccountLoginServerPreference()).toEqual(preference);
    },
  );

  it.each([
    "not-json",
    "null",
    "{}",
    '{"type":"other"}',
    '{"type":"server"}',
    '{"type":"server","name":42}',
    '{"type":"server","name":"   "}',
  ])("treats invalid stored preference %s as missing", (storedValue) => {
    stubLocalStorage(storedValue);
    expect(readStoredAccountLoginServerPreference()).toBeUndefined();
  });

  it("honors explicit none and an online preferred server", () => {
    const servers = [gameServer("Artix", { playerCount: 1_000 })];

    expect(
      resolveAccountLoginServerPreference(servers, { type: "none" }),
    ).toEqual({ type: "none" });
    expect(
      resolveAccountLoginServerPreference(servers, {
        type: "server",
        name: "Artix",
      }),
    ).toEqual({ type: "server", name: "Artix" });
  });

  it("falls back to the first online server with capacity", () => {
    const servers = [
      gameServer("Offline", { online: false }),
      gameServer("Full", { playerCount: 1_000 }),
      gameServer("Available"),
    ];

    expect(
      resolveAccountLoginServerPreference(servers, {
        type: "server",
        name: "Missing",
      }),
    ).toEqual({ type: "server", name: "Available" });
    expect(resolveAccountLoginServerPreference(servers, undefined)).toEqual({
      type: "server",
      name: "Available",
    });
  });

  it("reports unavailable when no fallback server has capacity", () => {
    expect(
      resolveAccountLoginServerPreference(
        [
          gameServer("Offline", { online: false }),
          gameServer("Full", { playerCount: 1_000 }),
        ],
        undefined,
      ),
    ).toEqual({ type: "unavailable" });
  });
});
