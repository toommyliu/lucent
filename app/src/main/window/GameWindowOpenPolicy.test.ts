import { describe, expect, it } from "vitest";

import { parseAllowedGameWindowOpenUrl } from "./GameWindowOpenPolicy";

describe("parseAllowedGameWindowOpenUrl", () => {
  it("allows configured game domains and rejects other external URLs", () => {
    expect(
      parseAllowedGameWindowOpenUrl("https://account.aq.com/CharPage?id=1")
        ?.href,
    ).toBe("https://account.aq.com/CharPage?id=1");
    expect(
      parseAllowedGameWindowOpenUrl("https://support.artix.com/help")?.href,
    ).toBe("https://support.artix.com/help");
    expect(
      parseAllowedGameWindowOpenUrl(
        "https://github.com/settings/personal-access-tokens/new",
      )?.href,
    ).toBe("https://github.com/settings/personal-access-tokens/new");
    expect(
      parseAllowedGameWindowOpenUrl("https://github.com/settings/profile"),
    ).toBeNull();
    expect(
      parseAllowedGameWindowOpenUrl("https://aq.com.evil.test/help"),
    ).toBeNull();
    expect(
      parseAllowedGameWindowOpenUrl("https://user@aq.com/help"),
    ).toBeNull();
    expect(
      parseAllowedGameWindowOpenUrl("https://aq.com:8443/help"),
    ).toBeNull();
    expect(parseAllowedGameWindowOpenUrl("file:///tmp/lucent")).toBeNull();
  });
});
