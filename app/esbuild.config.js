const { build, context } = require("esbuild");
const { solidPlugin } = require("esbuild-plugin-solid");
const {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  rmdirSync,
  unlinkSync,
  unwatchFile,
  watchFile,
  writeFileSync,
} = require("fs");
const { dirname, join } = require("path");

const isProduction = process.env.NODE_ENV === "production";
const isWatch = process.argv.includes("--watch") || process.argv.includes("-w");
const skipInitialBuildNotify =
  process.env.LUCENT_DEV_BUILD_NOTIFY_SKIP_INITIAL === "1";
const notifiedLabels = new Set();
const staticAssetWatchIntervalMs = 100;

const baseOptions = {
  bundle: true,
  define: {
    LUCENT_DEV: JSON.stringify(!isProduction),
  },
  logLevel: "info",
  minify: isProduction,
  sourcemap: !isProduction,
};

const baseContentSecurityPolicyDirectives = {
  "default-src": ["'self'"],
  "script-src": ["'self'"],
  "style-src": ["'self'", "'unsafe-inline'"],
};

const formatContentSecurityPolicy = (overrides = {}) =>
  Object.entries({
    ...baseContentSecurityPolicyDirectives,
    ...overrides,
  })
    .map(([directive, values]) => `${directive} ${values.join(" ")}`)
    .join("; ");

const baseContentSecurityPolicy = formatContentSecurityPolicy();

const rendererViews = [
  {
    contentSecurityPolicy: formatContentSecurityPolicy({
      "default-src": ["'self'", "https://game.aq.com"],
      "script-src": ["'self'", "'unsafe-eval'"],
      "plugin-types": ["application/x-shockwave-flash"],
    }),
    entryPoint: "src/renderer/game/index.tsx",
    id: "game",
    title: "Lucent",
    bodyPrefix: [
      "    <embed",
      '      id="swf"',
      '      src="../../../../assets/loader.swf"',
      '      type="application/x-shockwave-flash"',
      '      wmode="opaque"',
      "    />",
    ].join("\n"),
  },
  {
    contentSecurityPolicy: baseContentSecurityPolicy,
    entryPoint: "src/renderer/settings/index.tsx",
    id: "settings",
    ready: true,
    title: "Settings",
  },
  {
    contentSecurityPolicy: baseContentSecurityPolicy,
    entryPoint: "src/renderer/account-manager/index.tsx",
    id: "account-manager",
    ready: true,
    title: "Account Manager",
  },
  {
    contentSecurityPolicy: baseContentSecurityPolicy,
    entryPoint: "src/renderer/combat-profiles/index.tsx",
    id: "combat-profiles",
    ready: true,
    title: "Combat Profiles",
  },
];

const mainOptions = {
  ...baseOptions,
  entryPoints: ["src/main/index.ts"],
  external: ["electron"],
  format: "cjs",
  outfile: "dist/main/index.js",
  platform: "node",
  target: "node12",
};

const rendererOptions = (view) => ({
  ...baseOptions,
  entryPoints: [view.entryPoint],
  format: "esm",
  outfile: `dist/renderer/${view.id}/index.js`,
  platform: "browser",
  plugins: [solidPlugin(), ...(view.plugins ?? [])],
  target: "chrome87",
});

const rendererBuildOptions = rendererViews.map(rendererOptions);

const sharedCssOptions = {
  ...baseOptions,
  assetNames: "assets/[name]-[hash]",
  entryPoints: ["src/renderer/styles.css"],
  loader: {
    ".woff2": "file",
  },
  outfile: "dist/renderer/styles.css",
};

const preloadOptions = {
  ...baseOptions,
  entryPoints: ["src/main/preload.ts"],
  external: ["electron"],
  format: "cjs",
  outfile: "dist/renderer/preload.js",
  platform: "node",
  target: "node12",
};

const rendererHtmlAttributes = (view) =>
  [
    'lang="en"',
    view.ready === true ? 'data-ready="false"' : undefined,
    'data-theme="dark"',
  ]
    .filter(Boolean)
    .join(" ");

const rendererIndexHtml = (view) => {
  const bodyPrefix =
    typeof view.bodyPrefix === "string" ? `${view.bodyPrefix}\n` : "";

  return `<!doctype html>
<html ${rendererHtmlAttributes(view)}>
  <head>
    <meta charset="utf-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="${view.contentSecurityPolicy}"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${view.title}</title>
    <link rel="stylesheet" href="../styles.css" />
    <link rel="stylesheet" href="./style.css" />
  </head>
  <body>
${bodyPrefix}    <div id="root"></div>
    <script type="module" src="./index.js"></script>
  </body>
</html>
`;
};

const copyRendererFiles = () => {
  for (const view of rendererViews) {
    const sourceDir = `src/renderer/${view.id}`;
    const targetDir = `dist/renderer/${view.id}`;
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(`${targetDir}/index.html`, rendererIndexHtml(view));

    const stylePath = `${sourceDir}/style.css`;
    const targetStylePath = `${targetDir}/style.css`;
    if (existsSync(stylePath)) {
      copyFileSync(stylePath, targetStylePath);
    } else if (existsSync(targetStylePath)) {
      unlinkSync(targetStylePath);
    }
  }
};

const removeRecursive = (path) => {
  if (!existsSync(path)) {
    return;
  }

  const stat = lstatSync(path);
  if (!stat.isDirectory()) {
    unlinkSync(path);
    return;
  }

  for (const entry of readdirSync(path)) {
    removeRecursive(join(path, entry));
  }
  rmdirSync(path);
};

const clean = () => {
  removeRecursive("dist");
};

const notifyBuild = (label, options = {}) => {
  const notifyPath = process.env.LUCENT_DEV_BUILD_NOTIFY;
  if (!notifyPath) {
    return;
  }

  if (
    options.skipInitial !== false &&
    skipInitialBuildNotify &&
    !notifiedLabels.has(label)
  ) {
    notifiedLabels.add(label);
    return;
  }
  notifiedLabels.add(label);

  mkdirSync(dirname(notifyPath), { recursive: true });
  require("fs").appendFileSync(
    notifyPath,
    `${JSON.stringify({
      label,
      labels: [label],
      pid: process.pid,
      time: Date.now(),
    })}\n`,
  );
};

const rendererStaticFilePaths = () =>
  rendererViews.map((view) => `src/renderer/${view.id}/style.css`);

const watchRendererStaticFiles = () => {
  const watchedPaths = rendererStaticFilePaths();
  const listener = (current, previous) => {
    if (
      current.mtimeMs === previous.mtimeMs &&
      current.size === previous.size
    ) {
      return;
    }

    try {
      copyRendererFiles();
      notifyBuild("renderer-html", { skipInitial: false });
    } catch (error) {
      console.error("Failed to copy renderer static files", error);
    }
  };

  for (const path of watchedPaths) {
    watchFile(path, { interval: staticAssetWatchIntervalMs }, listener);
  }

  return () => {
    for (const path of watchedPaths) {
      unwatchFile(path, listener);
    }
  };
};

const buildOnce = async () => {
  clean();
  await Promise.all([
    build(mainOptions),
    ...rendererBuildOptions.map((options) => build(options)),
    build(sharedCssOptions),
    build(preloadOptions),
  ]);
  copyRendererFiles();
};

const watch = async () => {
  if (!skipInitialBuildNotify) {
    clean();
  }
  const mainContext = await context({
    ...mainOptions,
    plugins: [
      {
        name: "lucent-main-watch-notify",
        setup(pluginBuild) {
          pluginBuild.onEnd((result) => {
            if (result.errors.length === 0) {
              notifyBuild("main");
            }
          });
        },
      },
    ],
  });
  const rendererContexts = await Promise.all(
    rendererBuildOptions.map((options, index) =>
      context({
        ...options,
        plugins: [
          ...(options.plugins ?? []),
          {
            name: `lucent-${rendererViews[index].id}-renderer-watch-copy`,
            setup(pluginBuild) {
              pluginBuild.onEnd((result) => {
                if (result.errors.length === 0) {
                  copyRendererFiles();
                  notifyBuild("renderer");
                }
              });
            },
          },
        ],
      }),
    ),
  );
  const preloadContext = await context({
    ...preloadOptions,
    plugins: [
      {
        name: "lucent-preload-watch-notify",
        setup(pluginBuild) {
          pluginBuild.onEnd((result) => {
            if (result.errors.length === 0) {
              notifyBuild("renderer");
            }
          });
        },
      },
    ],
  });
  const sharedCssContext = await context({
    ...sharedCssOptions,
    plugins: [
      {
        name: "lucent-shared-css-watch-notify",
        setup(pluginBuild) {
          pluginBuild.onEnd((result) => {
            if (result.errors.length === 0) {
              notifyBuild("renderer");
            }
          });
        },
      },
    ],
  });

  await Promise.all([
    mainContext.watch(),
    ...rendererContexts.map((rendererContext) => rendererContext.watch()),
    preloadContext.watch(),
    sharedCssContext.watch(),
  ]);
  copyRendererFiles();
  watchRendererStaticFiles();
};

const run = isWatch ? watch : buildOnce;

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
