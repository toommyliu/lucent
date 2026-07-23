import { describe, expect, it } from "vitest";

import {
  DEFAULT_ACCOUNT_SETTINGS,
  RANDOM_PRIVATE_ROOM_POLICY,
  applyAccountSettingsPatch,
  normalizeAccountSettings,
} from "./accountSettings";

describe("account settings", () => {
  it("normalizes fields independently", () => {
    expect(
      normalizeAccountSettings({
        scripts: {
          restartAfterReconnect: true,
          roomPolicy: { kind: "specific", roomNumber: 42 },
          safeStartStop: "invalid",
        },
      }),
    ).toEqual({
      version: 1,
      scripts: {
        restartAfterReconnect: true,
        roomPolicy: { kind: "specific", roomNumber: 42 },
        safeStartStop: true,
      },
    });
  });

  it("accepts every room policy", () => {
    expect(
      normalizeAccountSettings({
        scripts: { roomPolicy: { kind: "public" } },
      }).scripts.roomPolicy,
    ).toEqual({ kind: "public" });
    expect(
      normalizeAccountSettings({
        scripts: { roomPolicy: { kind: "random-private" } },
      }).scripts.roomPolicy,
    ).toEqual({ kind: "random-private" });
    expect(
      normalizeAccountSettings({
        scripts: { roomPolicy: { kind: "specific", roomNumber: 1 } },
      }).scripts.roomPolicy,
    ).toEqual({ kind: "specific", roomNumber: 1 });
    expect(
      normalizeAccountSettings({
        scripts: {
          roomPolicy: { kind: "specific", roomNumber: 99_999 },
        },
      }).scripts.roomPolicy,
    ).toEqual({ kind: "specific", roomNumber: 99_999 });
  });

  it("defaults invalid room policies to random private", () => {
    expect(
      normalizeAccountSettings({
        scripts: {
          roomPolicy: { kind: "specific", roomNumber: 0 },
        },
      }).scripts.roomPolicy,
    ).toEqual(RANDOM_PRIVATE_ROOM_POLICY);
    expect(
      normalizeAccountSettings({
        scripts: { roomPolicy: { kind: "unknown" } },
      }).scripts.roomPolicy,
    ).toEqual(RANDOM_PRIVATE_ROOM_POLICY);
  });

  it("patches one field without dropping siblings", () => {
    expect(
      applyAccountSettingsPatch(DEFAULT_ACCOUNT_SETTINGS, {
        scripts: { restartAfterReconnect: true },
      }),
    ).toEqual({
      ...DEFAULT_ACCOUNT_SETTINGS,
      scripts: {
        ...DEFAULT_ACCOUNT_SETTINGS.scripts,
        restartAfterReconnect: true,
      },
    });
  });
});
