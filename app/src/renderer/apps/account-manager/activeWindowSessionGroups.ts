import type { AccountScriptSession } from "@lucent/core/accounts";

export interface ActiveWindowSessionGroup {
  readonly key: string;
  readonly sessions: readonly AccountScriptSession[];
  readonly shared: boolean;
}

/** Groups tracked sessions by their owning native BrowserWindow. */
export const groupActiveWindowSessions = (
  sessions: readonly AccountScriptSession[],
): readonly ActiveWindowSessionGroup[] => {
  const sessionsByGroup = new Map<string, AccountScriptSession[]>();
  for (const session of sessions) {
    const key =
      session.gameWindowGroupId === undefined
        ? `session:${session.gameWindowId}`
        : `window:${session.gameWindowGroupId}`;
    const group = sessionsByGroup.get(key);
    if (group === undefined) {
      sessionsByGroup.set(key, [session]);
    } else {
      group.push(session);
    }
  }

  const groups = [...sessionsByGroup].map(([key, groupedSessions]) => ({
    key,
    sessions: groupedSessions,
    shared: groupedSessions.length > 1,
  }));

  // Headerless single-session windows must not follow a headed shared window.
  return [
    ...groups.filter((group) => !group.shared),
    ...groups.filter((group) => group.shared),
  ];
};
