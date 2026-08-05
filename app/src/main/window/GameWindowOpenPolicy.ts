const GAME_WINDOW_OPEN_DOMAIN_ROOTS = [
  "https://aq.com",
  "https://artix.com",
  "https://account.aq.com",
  "http://aqwwiki.wikidot.com",
  "https://heromart.com",
  "http://account.aqworlds.com/",
] as const;

const GAME_WINDOW_OPEN_RULES = GAME_WINDOW_OPEN_DOMAIN_ROOTS.map(
  (domainRoot) => new URL(domainRoot),
);

const GAME_WINDOW_OPEN_EXACT_URLS = new Set([
  "https://github.com/settings/personal-access-tokens/new",
]);

const isAllowedUrl = (url: URL): boolean =>
  GAME_WINDOW_OPEN_EXACT_URLS.has(url.href) ||
  GAME_WINDOW_OPEN_RULES.some(
    (rule) =>
      url.protocol === rule.protocol &&
      (url.hostname === rule.hostname ||
        url.hostname.endsWith(`.${rule.hostname}`)),
  );

export const parseAllowedGameWindowOpenUrl = (rawUrl: string): URL | null => {
  try {
    const url = new URL(rawUrl);
    if (
      url.port !== "" ||
      url.username !== "" ||
      url.password !== "" ||
      !isAllowedUrl(url)
    ) {
      return null;
    }

    return url;
  } catch {
    return null;
  }
};
