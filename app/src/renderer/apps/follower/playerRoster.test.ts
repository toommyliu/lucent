import { describe, expect, it } from "@effect/vitest";

import {
  filterPlayerRoster,
  observePlayerRoster,
  type PlayerRosterSource,
} from "./playerRoster";

describe("observePlayerRoster", () => {
  it.each([
    ["", ["Alpha", "Example Player", "XYZ"]],
    ["AMP", ["Example Player"]],
    ["missing", []],
  ] as const)("filters a roster with query %s", (query, expected) => {
    expect(
      filterPlayerRoster(["Alpha", "Example Player", "XYZ"], query),
    ).toEqual(expected);
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
