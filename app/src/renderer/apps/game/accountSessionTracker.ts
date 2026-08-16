import type {
  AccountGameConnectionState,
  AccountGameLoginState,
  AccountGameScriptState,
  AccountGameSessionReport,
} from "@lucent/core/accounts";

export type AccountSessionRuntimeSnapshot = Omit<
  AccountGameSessionReport,
  "rendererGeneration"
>;

export interface AccountSessionTrackerToken {
  readonly connectionEpoch: number;
  readonly launchAttempt: number;
}

export interface AccountSessionTrackerState extends AccountSessionTrackerToken {
  readonly reportRevision: number;
  readonly connection: AccountGameConnectionState;
  readonly login: AccountGameLoginState;
  readonly script: AccountGameScriptState;
}

export type AccountSessionTrackerAction =
  | { readonly type: "launch-start" }
  | { readonly type: "launch-cancel" }
  | { readonly type: "connection-start" }
  | { readonly type: "connection-lost" }
  | {
      readonly type: "login";
      readonly login: AccountGameLoginState;
      readonly launchAttempt: number;
    }
  | {
      readonly type: "ready";
      readonly username: string;
      readonly token: AccountSessionTrackerToken;
    }
  | {
      readonly type: "script";
      readonly script: AccountGameScriptState;
      readonly token: AccountSessionTrackerToken;
    };

export const initialAccountSessionTrackerState =
  (): AccountSessionTrackerState => ({
    connection: { state: "offline" },
    connectionEpoch: 0,
    launchAttempt: 0,
    login: { state: "idle" },
    reportRevision: 0,
    script: { state: "idle" },
  });

const sameToken = (
  left: AccountSessionTrackerToken,
  right: AccountSessionTrackerToken,
): boolean =>
  left.connectionEpoch === right.connectionEpoch &&
  left.launchAttempt === right.launchAttempt;

const next = (
  state: AccountSessionTrackerState,
  update: Partial<
    Pick<
      AccountSessionTrackerState,
      "connection" | "login" | "script" | "connectionEpoch" | "launchAttempt"
    >
  >,
): AccountSessionTrackerState => ({
  ...state,
  ...update,
  reportRevision: state.reportRevision + 1,
});

/** Reduces causal session events; tokened async completions are ignored. */
export const reduceAccountSessionTracker = (
  state: AccountSessionTrackerState,
  action: AccountSessionTrackerAction,
): AccountSessionTrackerState => {
  switch (action.type) {
    case "launch-start":
      return next(state, {
        launchAttempt: state.launchAttempt + 1,
        login: { state: "waiting-for-game" },
      });
    case "launch-cancel": {
      // Cancel pending launch work without asserting a connection change.
      return next(state, {
        launchAttempt: state.launchAttempt + 1,
        login: { state: "idle" },
      });
    }
    case "connection-start":
      return next(state, {
        connection: {
          state: "connecting",
          ...(state.connection.state === "online"
            ? { lastUsername: state.connection.username }
            : state.connection.lastUsername === undefined
              ? {}
              : { lastUsername: state.connection.lastUsername }),
        },
        connectionEpoch: state.connectionEpoch + 1,
        script: { state: "idle" },
      });
    case "connection-lost": {
      const lastUsername =
        state.connection.state === "online"
          ? state.connection.username
          : state.connection.lastUsername;
      const scriptName =
        state.script.state === "idle" ? undefined : state.script.name;
      return next(state, {
        connection: {
          state: "offline",
          ...(lastUsername === undefined ? {} : { lastUsername }),
        },
        connectionEpoch: state.connectionEpoch + 1,
        login: { state: "idle" },
        script: {
          state: "stopped",
          ...(scriptName === undefined ? {} : { name: scriptName }),
          reason: "Logged out",
        },
      });
    }
    case "login":
      if (action.launchAttempt !== state.launchAttempt) return state;
      if (action.login.state === "select-server") {
        return next(state, {
          connection: {
            state: "offline",
            ...(state.connection.state === "online"
              ? { lastUsername: state.connection.username }
              : state.connection.lastUsername === undefined
                ? {}
                : { lastUsername: state.connection.lastUsername }),
          },
          connectionEpoch: state.connectionEpoch + 1,
          login: action.login,
        });
      }
      return next(state, { login: action.login });
    case "ready":
      if (!sameToken(action.token, state)) return state;
      return next(state, {
        connection: { state: "online", username: action.username },
        login: { state: "idle" },
      });
    case "script":
      if (!sameToken(action.token, state)) return state;
      return next(state, { script: action.script });
  }
};

export interface AccountSessionTracker {
  readonly beginLaunch: () => AccountSessionTrackerToken;
  readonly beginConnection: () => AccountSessionTrackerToken;
  readonly disconnect: () => AccountSessionTrackerToken;
  readonly cancelLaunch: () => AccountSessionTrackerToken;
  readonly currentToken: () => AccountSessionTrackerToken;
  readonly isLaunchCurrent: (launchAttempt: number) => boolean;
  readonly isTokenCurrent: (token: AccountSessionTrackerToken) => boolean;
  readonly setLogin: (
    login: AccountGameLoginState,
    launchAttempt: number,
  ) => void;
  readonly setReady: (
    username: string,
    token: AccountSessionTrackerToken,
  ) => boolean;
  readonly setScript: (
    script: AccountGameScriptState,
    token: AccountSessionTrackerToken,
  ) => boolean;
  readonly snapshot: () => AccountSessionRuntimeSnapshot;
  readonly state: () => AccountSessionTrackerState;
}

/** Creates the renderer's single writer for account session reports. */
export const makeAccountSessionTracker = (): AccountSessionTracker => {
  let state = initialAccountSessionTrackerState();

  const dispatch = (action: AccountSessionTrackerAction): void => {
    state = reduceAccountSessionTracker(state, action);
  };

  return {
    beginConnection: () => {
      dispatch({ type: "connection-start" });
      return trackerToken(state);
    },
    beginLaunch: () => {
      dispatch({ type: "launch-start" });
      return trackerToken(state);
    },
    cancelLaunch: () => {
      dispatch({ type: "launch-cancel" });
      return trackerToken(state);
    },
    currentToken: () => trackerToken(state),
    disconnect: () => {
      dispatch({ type: "connection-lost" });
      return trackerToken(state);
    },
    isLaunchCurrent: (launchAttempt) => state.launchAttempt === launchAttempt,
    isTokenCurrent: (token) => sameToken(token, state),
    setLogin: (login, launchAttempt) =>
      dispatch({ type: "login", launchAttempt, login }),
    setReady: (username, token) => {
      const previousRevision = state.reportRevision;
      dispatch({ type: "ready", token, username });
      return state.reportRevision !== previousRevision;
    },
    setScript: (script, token) => {
      const previousRevision = state.reportRevision;
      dispatch({ type: "script", script, token });
      return state.reportRevision !== previousRevision;
    },
    snapshot: () => ({
      connection: state.connection,
      login: state.login,
      revision: state.reportRevision,
      script: state.script,
    }),
    state: () => state,
  };
};

const trackerToken = (
  state: AccountSessionTrackerState,
): AccountSessionTrackerToken => ({
  connectionEpoch: state.connectionEpoch,
  launchAttempt: state.launchAttempt,
});
