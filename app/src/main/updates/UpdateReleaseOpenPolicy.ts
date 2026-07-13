const UPDATE_RELEASE_ROOT = new URL(
  "https://github.com/toommyliu/lucent/releases/",
);

export const parseAllowedUpdateReleaseUrl = (rawUrl: string): URL | null => {
  try {
    const url = new URL(rawUrl);
    if (
      url.origin !== UPDATE_RELEASE_ROOT.origin ||
      url.username !== "" ||
      url.password !== "" ||
      !url.pathname.startsWith(UPDATE_RELEASE_ROOT.pathname)
    ) {
      return null;
    }

    return url;
  } catch {
    return null;
  }
};
