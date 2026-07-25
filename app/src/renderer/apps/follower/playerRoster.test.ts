import { describe, expect, it } from "vitest";

import {
  filterPlayerRoster,
  observePlayerRoster,
  type PlayerRosterSource,
} from "./playerRoster";

describe("observePlayerRoster", () => {
  it("filters players by a case-insensitive substring query", () => {
    const players = ["Alpha", "Example Player", "XYZ"];

    expect(filterPlayerRoster(players, "")).toEqual(players);
    expect(filterPlayerRoster(players, "AMP")).toEqual(["Example Player"]);
    expect(filterPlayerRoster(players, "missing")).toEqual([]);
  });

  it("does not let an initial read overwrite a newer roster event", async () => {
    let publish: ((players: readonly string[]) => void) | undefined;
    let resolveInitial: ((players: readonly string[]) => void) | undefined;
    const source: PlayerRosterSource = {
      getPlayers: () =>
        new Promise((resolve) => {
          resolveInitial = resolve;
        }),
      onPlayersChanged: (listener) => {
        publish = listener;
        return () => undefined;
      },
    };
    const observed: Array<readonly string[]> = [];
    const stop = observePlayerRoster(
      source,
      (players) => observed.push(players),
      () => undefined,
    );

    publish!(["New"]);
    resolveInitial!(["Old"]);
    await Promise.resolve();

    expect(observed).toEqual([["New"]]);
    stop();
  });

  it("applies the initial roster when no newer event arrives", async () => {
    const source: PlayerRosterSource = {
      getPlayers: () => Promise.resolve(["Alice"]),
      onPlayersChanged: () => () => undefined,
    };
    const observed: Array<readonly string[]> = [];
    const stop = observePlayerRoster(
      source,
      (players) => observed.push(players),
      () => undefined,
    );

    await Promise.resolve();

    expect(observed).toEqual([["Alice"]]);
    stop();
  });
});
