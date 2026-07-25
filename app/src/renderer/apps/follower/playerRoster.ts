export interface PlayerRosterSource {
  readonly getPlayers: () => Promise<readonly string[]>;
  readonly onPlayersChanged: (
    listener: (players: readonly string[]) => void,
  ) => () => void;
}

export const filterPlayerRoster = (
  players: readonly string[],
  query: string,
): readonly string[] => {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return normalizedQuery === ""
    ? players
    : players.filter((player) =>
        player.toLocaleLowerCase().includes(normalizedQuery),
      );
};

export const observePlayerRoster = (
  source: PlayerRosterSource,
  listener: (players: readonly string[]) => void,
  onError: (cause: unknown) => void,
): (() => void) => {
  let disposed = false;
  let receivedPlayersChanged = false;
  const unsubscribe = source.onPlayersChanged((players) => {
    if (disposed) {
      return;
    }
    receivedPlayersChanged = true;
    listener(players);
  });

  void source
    .getPlayers()
    .then((players) => {
      if (!disposed && !receivedPlayersChanged) {
        listener(players);
      }
    })
    .catch((cause: unknown) => {
      if (!disposed) {
        onError(cause);
      }
    });

  return () => {
    disposed = true;
    unsubscribe();
  };
};
