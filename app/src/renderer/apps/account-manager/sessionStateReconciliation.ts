import {
  presentAccountGameSession,
  type AccountGameSession,
} from "@lucent/core/accounts";

const sameVisibleSession = (
  previous: AccountGameSession,
  next: AccountGameSession,
): boolean => {
  const previousPresentation = presentAccountGameSession(previous);
  const nextPresentation = presentAccountGameSession(next);
  return (
    previous.gameWindowId === next.gameWindowId &&
    previous.gameWindowGroupId === next.gameWindowGroupId &&
    previous.rendererGeneration === next.rendererGeneration &&
    previous.revision === next.revision &&
    previousPresentation.username === nextPresentation.username &&
    previousPresentation.scriptName === nextPresentation.scriptName &&
    previousPresentation.status === nextPresentation.status &&
    previousPresentation.message === nextPresentation.message
  );
};

const sessionIdentityKey = (session: AccountGameSession): string =>
  `window:${session.gameWindowId}`;

/** Applies main-process session snapshots without crossing generation barriers. */
export const reconcileSessions = (
  previousSessions: readonly AccountGameSession[],
  nextSessions: readonly AccountGameSession[],
): readonly AccountGameSession[] => {
  const previousByIdentity = new Map(
    previousSessions.map((session) => [sessionIdentityKey(session), session]),
  );
  let changed = previousSessions.length !== nextSessions.length;
  const sessions = nextSessions.map((session, index) => {
    const previous = previousByIdentity.get(sessionIdentityKey(session));
    if (previous !== undefined) {
      if (previous.rendererGeneration > session.rendererGeneration) {
        changed ||= previousSessions[index] !== previous;
        return previous;
      }

      if (previous.rendererGeneration < session.rendererGeneration) {
        changed = true;
        return session;
      }

      if (previous.revision > session.revision) {
        changed ||= previousSessions[index] !== previous;
        return previous;
      }
    }

    if (previous !== undefined && sameVisibleSession(previous, session)) {
      changed ||= previousSessions[index] !== previous;
      return previous;
    }

    changed = true;
    return session;
  });

  return changed ? sessions : previousSessions;
};
