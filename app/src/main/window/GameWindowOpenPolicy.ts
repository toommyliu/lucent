const GAME_WINDOW_OPEN_DOMAIN_ROOTS = [
  "https://aq.com",
  "https://artix.com",
  "https://account.aq.com",
  "http://aqwwiki.wikidot.com",
  "https://heromart.com",
] as const;

const GAME_WINDOW_OPEN_RULES = GAME_WINDOW_OPEN_DOMAIN_ROOTS.map(
  (domainRoot) => new URL(domainRoot),
);

const isAllowedUrl = (url: URL): boolean =>
  GAME_WINDOW_OPEN_RULES.some(
    (rule) =>
      url.protocol === rule.protocol &&
      (url.hostname === rule.hostname ||
        url.hostname.endsWith(`.${rule.hostname}`)),
  );

export const parseAllowedGameWindowOpenUrl = (
  rawUrl: string,
): string | null => {
  try {
    const url = new URL(rawUrl);
    if (url.port !== "" || !isAllowedUrl(url)) {
      return null;
    }

    return url.href;
  } catch {
    return null;
  }
};
