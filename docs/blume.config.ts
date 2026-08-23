import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "blume";

const scriptingReferenceRoot = fileURLToPath(
  new URL("./src/content/docs/reference/scripting", import.meta.url),
);

/** Collect the page routes directly inside a documentation directory. */
const collectPageRoutes = (directory: string, routeRoot: string): string[] =>
  readdirSync(directory, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        (entry.name.endsWith(".md") || entry.name.endsWith(".mdx")),
    )
    .map((entry) => entry.name.replace(/\.mdx?$/u, ""))
    .toSorted((left, right) => {
      if (left === "index") {
        return -1;
      }
      if (right === "index") {
        return 1;
      }
      return left.localeCompare(right);
    })
    .map((name) => (name === "index" ? routeRoot : `${routeRoot}/${name}`));

/** Collect routes generated below the scripting reference root. */
const collectRouteSuffixes = (
  directory: string,
  segments: readonly string[] = [],
): string[] => {
  const suffixes: string[] = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      suffixes.push(
        ...collectRouteSuffixes(join(directory, entry.name), [
          ...segments,
          entry.name,
        ]),
      );
      continue;
    }

    const extension = entry.name.endsWith(".mdx")
      ? ".mdx"
      : entry.name.endsWith(".md")
        ? ".md"
        : null;
    if (extension === null) {
      continue;
    }

    const name = entry.name.slice(0, -extension.length);
    const routeSegments = name === "index" ? segments : [...segments, name];
    suffixes.push(
      routeSegments.length === 0 ? "" : `/${routeSegments.join("/")}`,
    );
  }

  return suffixes.toSorted();
};

const legacyScriptingRedirects = collectRouteSuffixes(
  scriptingReferenceRoot,
).flatMap((suffix) => {
  const destination = `/reference/scripting${suffix}`;
  const redirects = [{ from: `/scripting${suffix}`, to: destination }];

  if (suffix === "/types" || suffix.startsWith("/types/")) {
    redirects.push({
      from: suffix,
      to: destination,
    });
  }

  return redirects;
});

const redirects = [
  {
    from: "/guides/scripting",
    to: "/guides/scripting/script-format",
  },
  {
    from: "/reference/scripting/imports",
    to: "/guides/scripting/script-format",
  },
  {
    from: "/reference/scripting/api",
    to: "/reference/scripting",
  },
  {
    from: "/reference/scripting/features",
    to: "/reference/scripting",
  },
  ...legacyScriptingRedirects,
];

const moduleGroup = (label: string, segment: string) => {
  const routeRoot = `/reference/scripting/${segment}`;

  return {
    items: collectPageRoutes(join(scriptingReferenceRoot, segment), routeRoot),
    label,
  };
};

export default defineConfig({
  analytics: {
    vercel: true,
  },
  content: {
    root: "src/content/docs",
  },
  description:
    "Guides and reference for the Lucent AdventureQuest Worlds toolkit.",
  github: {
    dir: "docs",
    owner: "toommyliu",
    repo: "lucent",
  },
  lastModified: true,
  navigation: {
    sidebar: {
      display: "group",
      items: [
        {
          items: [
            "/guides/app",
            {
              items: [
                "/guides/scripting/script-format",
                "/guides/scripting/script-inputs",
                {
                  items: [
                    "/guides/scripting/armying/army",
                    "/guides/scripting/armying/loop-taunt",
                  ],
                  label: "Armying",
                },
                "/guides/scripting/enhancements",
                "/guides/scripting/editor-setup",
              ],
              label: "Scripting",
            },
          ],
          label: "Guides",
          root: "/guides",
        },
        {
          items: [
            "/reference/cli",
            {
              items: [
                {
                  label: "Overview",
                  root: "/reference/scripting",
                },
                moduleGroup("lucent/api", "api"),
                {
                  label: "lucent/script",
                  root: "/reference/scripting/script",
                },
                {
                  label: "lucent/autozone",
                  root: "/reference/scripting/autozone",
                },
                {
                  label: "lucent/autorelogin",
                  root: "/reference/scripting/autorelogin",
                },
                {
                  label: "effect",
                  root: "/reference/scripting/effect",
                },
                "/reference/scripting/types",
              ],
              display: "group",
              label: "Scripting",
            },
          ],
          label: "Reference",
          root: "/reference",
        },
      ],
    },
    tabs: [
      {
        href: "/guides",
        icon: "book-open",
        label: "Guides",
        path: "/guides",
      },
      {
        href: "/reference",
        icon: "braces",
        label: "Reference",
        path: "/reference",
      },
    ],
  },
  redirects,
  theme: {
    fonts: {
      body: "inter",
      display: "inter",
      mono: "jetbrains-mono",
    },
    mode: "system",
  },
  title: "Lucent",
  toc: {
    maxHeadingLevel: 3,
    minHeadingLevel: 2,
  },
});
