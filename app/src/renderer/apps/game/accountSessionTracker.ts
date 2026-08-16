import type {
  AccountSessionConnection,
  AccountSessionLogin,
  AccountSessionReport,
  AccountSessionRuntime,
  AccountSessionScript,
} from "@lucent/core/accounts";

export interface AccountSessionTrackerOptions {
  readonly onReportError: (error: unknown) => void;
  readonly rendererGeneration: Promise<number>;
  readonly report: (report: AccountSessionReport) => Promise<void>;
}

export interface AccountSessionTracker {
  /** Starts a launch generation and invalidates later updates from older launches. */
  readonly beginLaunch: (expectedUsername: string) => number;
  readonly cancelLaunch: () => boolean;
  /** Starts an identity epoch and invalidates pending reads from older game state. */
  readonly connectionStarted: () => number;
  readonly currentIdentityEpoch: () => number;
  readonly disconnected: () => number;
  readonly failLaunch: (attempt: number, message: string) => boolean;
  readonly flush: () => Promise<void>;
  readonly getRuntime: () => AccountSessionRuntime;
  readonly isCurrentLaunch: (attempt: number) => boolean;
  /** Verifies that async work still belongs to the same authenticated connection. */
  readonly isOnlineAs: (epoch: number, username: string) => boolean;
  readonly markOnline: (epoch: number, username: string) => boolean;
  readonly setLaunchScript: (
    attempt: number,
    script: AccountSessionScript,
  ) => boolean;
  readonly setLogin: (attempt: number, login: AccountSessionLogin) => boolean;
  readonly setScript: (script: AccountSessionScript) => boolean;
  readonly start: () => void;
}

interface TrackedLaunch {
  readonly attempt: number;
  readonly expectedUsername: string;
  readonly manualServerSelection: boolean;
  readonly progressActive: boolean;
}

const initialRuntime = (): AccountSessionRuntime => ({
  connection: { state: "offline" },
  login: { state: "idle" },
  script: { state: "idle" },
});

const connectionUsername = (
  connection: AccountSessionConnection,
): string | undefined =>
  connection.state === "online" ? connection.username : connection.lastUsername;

const sameConnection = (
  left: AccountSessionConnection,
  right: AccountSessionConnection,
): boolean =>
  left.state === right.state &&
  connectionUsername(left) === connectionUsername(right);

const sameLogin = (
  left: AccountSessionLogin,
  right: AccountSessionLogin,
): boolean =>
  left.state === right.state &&
  ("attemptsRemaining" in left ? left.attemptsRemaining : undefined) ===
    ("attemptsRemaining" in right ? right.attemptsRemaining : undefined) &&
  ("message" in left ? left.message : undefined) ===
    ("message" in right ? right.message : undefined) &&
  ("server" in left ? left.server : undefined) ===
    ("server" in right ? right.server : undefined);

const sameScript = (
  left: AccountSessionScript,
  right: AccountSessionScript,
): boolean =>
  left.state === right.state &&
  left.name === right.name &&
  ("message" in left ? left.message : undefined) ===
    ("message" in right ? right.message : undefined);

const sameRuntime = (
  left: AccountSessionRuntime,
  right: AccountSessionRuntime,
): boolean =>
  sameConnection(left.connection, right.connection) &&
  sameLogin(left.login, right.login) &&
  sameScript(left.script, right.script);

const usernamesEqual = (left: string, right: string): boolean =>
  left.localeCompare(right, undefined, { sensitivity: "accent" }) === 0;

export const makeAccountSessionTracker = (
  options: AccountSessionTrackerOptions,
): AccountSessionTracker => {
  let identityEpoch = 0;
  let launchAttempt = 0;
  let currentLaunch: TrackedLaunch | undefined;
  let reportRevision = 0;
  let runtime = initialRuntime();
  let started = false;
  let reportQueue = Promise.resolve();

  const publish = (): void => {
    const revision = ++reportRevision;
    const snapshot = runtime;
    reportQueue = reportQueue
      .then(async () => {
        const rendererGeneration = await options.rendererGeneration;
        await options.report({
          rendererGeneration,
          revision,
          runtime: snapshot,
        });
      })
      .catch(options.onReportError);
  };

  const commit = (next: AccountSessionRuntime): boolean => {
    if (sameRuntime(runtime, next)) return false;
    runtime = next;
    if (started) publish();
    return true;
  };

  const start = (): void => {
    if (started) return;
    started = true;
    publish();
  };

  const beginLaunch = (expectedUsername: string): number => {
    const attempt = ++launchAttempt;
    identityEpoch += 1;
    currentLaunch = {
      attempt,
      expectedUsername: expectedUsername.trim(),
      manualServerSelection: false,
      progressActive: true,
    };
    commit({ ...runtime, login: { state: "waiting-for-game" } });
    return attempt;
  };

  const cancelLaunch = (): boolean => {
    launchAttempt += 1;
    identityEpoch += 1;
    currentLaunch = undefined;
    return commit({ ...runtime, login: { state: "idle" } });
  };

  const setLogin = (attempt: number, login: AccountSessionLogin): boolean => {
    if (currentLaunch?.attempt !== attempt || !currentLaunch.progressActive) {
      return false;
    }
    if (login.state === "waiting-for-server") {
      currentLaunch = { ...currentLaunch, manualServerSelection: true };
    }
    commit({ ...runtime, login });
    return true;
  };

  const failLaunch = (attempt: number, message: string): boolean => {
    if (currentLaunch?.attempt !== attempt || !currentLaunch.progressActive) {
      return false;
    }
    currentLaunch = { ...currentLaunch, progressActive: false };
    return commit({
      ...runtime,
      login: { message, state: "failed" },
    });
  };

  const connectionStarted = (): number => {
    const epoch = ++identityEpoch;
    const lastUsername = connectionUsername(runtime.connection);
    if (currentLaunch !== undefined) {
      currentLaunch = { ...currentLaunch, progressActive: true };
    }
    commit({
      ...runtime,
      connection:
        lastUsername === undefined
          ? { state: "connecting" }
          : { lastUsername, state: "connecting" },
      login:
        runtime.login.state === "idle"
          ? runtime.login
          : { state: "waiting-for-player" },
    });
    return epoch;
  };

  const disconnected = (): number => {
    const epoch = ++identityEpoch;
    const lastUsername = connectionUsername(runtime.connection);
    commit({
      ...runtime,
      connection:
        lastUsername === undefined
          ? { state: "offline" }
          : { lastUsername, state: "offline" },
      login:
        currentLaunch?.manualServerSelection === true &&
        runtime.login.state === "waiting-for-player"
          ? { state: "waiting-for-server" }
          : runtime.login,
    });
    return epoch;
  };

  const markOnline = (epoch: number, username: string): boolean => {
    const normalized = username.trim();
    if (epoch !== identityEpoch || normalized === "") return false;

    let login: AccountSessionLogin = { state: "idle" };
    if (
      currentLaunch !== undefined &&
      !usernamesEqual(currentLaunch.expectedUsername, normalized)
    ) {
      currentLaunch = { ...currentLaunch, progressActive: false };
      login = {
        message: `Expected ${currentLaunch.expectedUsername}, connected as ${normalized}`,
        state: "failed",
      };
    } else {
      currentLaunch = undefined;
    }
    commit({
      ...runtime,
      connection: { state: "online", username: normalized },
      login,
    });
    return true;
  };

  const setScript = (script: AccountSessionScript): boolean => {
    const previousName = runtime.script.name;
    const nextScript =
      script.state === "stopped" &&
      script.name === undefined &&
      previousName !== undefined
        ? { ...script, name: previousName }
        : script;
    return commit({ ...runtime, script: nextScript });
  };

  const isCurrentLaunch = (attempt: number): boolean =>
    attempt === launchAttempt;

  const isOnlineAs = (epoch: number, username: string): boolean =>
    epoch === identityEpoch &&
    runtime.connection.state === "online" &&
    usernamesEqual(runtime.connection.username, username.trim());

  const setLaunchScript = (
    attempt: number,
    script: AccountSessionScript,
  ): boolean => isCurrentLaunch(attempt) && setScript(script);

  return {
    beginLaunch,
    cancelLaunch,
    connectionStarted,
    currentIdentityEpoch: () => identityEpoch,
    disconnected,
    failLaunch,
    flush: () => reportQueue,
    getRuntime: () => runtime,
    isCurrentLaunch,
    isOnlineAs,
    markOnline,
    setLaunchScript,
    setLogin,
    setScript,
    start,
  };
};
