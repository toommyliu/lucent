export const formatGameWindowTitle = (
  applicationName: string,
  showUsername: boolean,
  username: string | undefined,
): string =>
  showUsername && username !== undefined
    ? `${applicationName} - ${username}`
    : applicationName;
