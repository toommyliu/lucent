const { build, context } = require("esbuild");
const { solidPlugin } = require("esbuild-plugin-solid");
const { createHash } = require("crypto");
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
  appendFileSync,
} = require("fs");
const { dirname, join } = require("path");

const isProduction = process.env.NODE_ENV === "production";
const isWatch = process.argv.includes("--watch") || process.argv.includes("-w");
const skipInitialBuildNotify =
  process.env.LUCENT_DEV_BUILD_NOTIFY_SKIP_INITIAL === "1";
const notifiedBuilds = new Set();
const staticAssetWatchIntervalMs = 100;

const baseOptions = {
  bundle: true,
  logLevel: "info",
  minify: isProduction,
  sourcemap: !isProduction,
};

const mainOptions = {
  ...baseOptions,
  entryPoints: ["src/main/index.ts"],
  external: ["electron"],
  format: "cjs",
  outfile: "dist/main/index.js",
  platform: "node",
  target: "node12",
};

const scriptFileWorkerOptions = {
  ...baseOptions,
  entryPoints: ["src/main/internal/scripting/ScriptFileWorker.ts"],
  format: "cjs",
  outfile: "dist/main/script-file-worker.js",
  platform: "node",
  target: "node12",
};

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

const rendererThemeBootstrapScript =
  'document.documentElement.dataset.theme=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";';

const contentSecurityPolicyHash = (source) =>
  `'sha256-${createHash("sha256").update(source).digest("base64")}'`;

const rendererScriptSources = [
  "'self'",
  contentSecurityPolicyHash(rendererThemeBootstrapScript),
];

const formatRendererContentSecurityPolicy = (overrides = {}) =>
  Object.entries({
    "default-src": ["'self'"],
    "script-src": rendererScriptSources,
    "style-src": ["'self'", "'unsafe-inline'"],
    ...overrides,
  })
    .map(([directive, sources]) => `${directive} ${sources.join(" ")}`)
    .join("; ");

const createRendererView = (id, title, options = {}) => ({
  entryPoint: `src/renderer/apps/${id}/index.tsx`,
  id,
  title,
  ...options,
});

const rendererViews = [
  createRendererView("game", "Lucent", {
    contentSecurityPolicy: {
      "default-src": ["'self'", "https://game.aq.com"],
      "script-src": [...rendererScriptSources, "'unsafe-eval'"],
      "plugin-types": ["application/x-shockwave-flash"],
    },
    bodyHtml: [
      "    <embed",
      '      id="swf"',
      '      src="../../../../assets/loader.swf"',
      '      type="application/x-shockwave-flash"',
      "    />",
    ].join("\n"),
  }),
  createRendererView("settings", "Settings", { startsPending: true }),
  createRendererView("account-manager", "Account Manager", {
    startsPending: true,
  }),
  createRendererView("combat-profiles", "Combat Profiles", {
    startsPending: true,
  }),
  createRendererView("environment", "Environment", { startsPending: true }),
  createRendererView("follower", "Follower", { startsPending: true }),
  createRendererView("loader-grabber", "Loader Grabber", {
    startsPending: true,
  }),
  createRendererView("packets", "Packets", { startsPending: true }),
];

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

const rendererIndexHtml = (view) => {
  const startsPendingAttribute = view.startsPending
    ? ' data-ready="false"'
    : "";
  const body = typeof view.bodyHtml === "string" ? `${view.bodyHtml}\n` : "";
  const contentSecurityPolicy = formatRendererContentSecurityPolicy(
    view.contentSecurityPolicy,
  );

  return `<!doctype html>
<html lang="en"${startsPendingAttribute}>
  <head>
    <meta charset="utf-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="${contentSecurityPolicy}"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${view.title}</title>
    <script>${rendererThemeBootstrapScript}</script>
    <link rel="stylesheet" href="../styles.css" />
    <link rel="stylesheet" href="./style.css" />
  </head>
  <body>
${body}    <div id="root"></div>
    <script type="module" src="./index.js"></script>
  </body>
</html>
`;
};

const copyRendererFiles = () => {
  for (const view of rendererViews) {
    const sourceDir = `src/renderer/apps/${view.id}`;
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

  const initialBuildKey = options.initialBuildKey ?? label;

  if (
    options.skipInitial !== false &&
    skipInitialBuildNotify &&
    !notifiedBuilds.has(initialBuildKey)
  ) {
    notifiedBuilds.add(initialBuildKey);
    return;
  }
  notifiedBuilds.add(initialBuildKey);

  mkdirSync(dirname(notifyPath), { recursive: true });
  appendFileSync(
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
  rendererViews.map((view) => `src/renderer/apps/${view.id}/style.css`);

const fileChanged = (current, previous) =>
  current.mtimeMs !== previous.mtimeMs ||
  current.ctimeMs !== previous.ctimeMs ||
  current.size !== previous.size ||
  current.ino !== previous.ino;

const watchRendererStaticFiles = () => {
  const watchedPaths = rendererStaticFilePaths();
  const listener = (current, previous) => {
    if (!fileChanged(current, previous)) {
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

const watchLoaderSwf = () => {
  const loaderPath = join("..", "assets", "loader.swf");
  const listener = (current, previous) => {
    if (!fileChanged(current, previous)) {
      return;
    }

    notifyBuild("renderer", { skipInitial: false });
  };

  watchFile(loaderPath, { interval: staticAssetWatchIntervalMs }, listener);

  return () => {
    unwatchFile(loaderPath, listener);
  };
};

const buildOnce = async () => {
  clean();
  await Promise.all([
    build(mainOptions),
    build(scriptFileWorkerOptions),
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
              notifyBuild("main", { initialBuildKey: "main" });
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
                  notifyBuild("renderer", {
                    initialBuildKey: `renderer:${rendererViews[index].id}`,
                  });
                }
              });
            },
          },
        ],
      }),
    ),
  );
  const scriptFileWorkerContext = await context({
    ...scriptFileWorkerOptions,
    plugins: [
      {
        name: "lucent-script-file-worker-watch-notify",
        setup(pluginBuild) {
          pluginBuild.onEnd((result) => {
            if (result.errors.length === 0) {
              notifyBuild("main", { initialBuildKey: "script-file-worker" });
            }
          });
        },
      },
    ],
  });
  const preloadContext = await context({
    ...preloadOptions,
    plugins: [
      {
        name: "lucent-preload-watch-notify",
        setup(pluginBuild) {
          pluginBuild.onEnd((result) => {
            if (result.errors.length === 0) {
              notifyBuild("renderer", { initialBuildKey: "preload" });
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
              notifyBuild("renderer", { initialBuildKey: "shared-css" });
            }
          });
        },
      },
    ],
  });

  await Promise.all([
    mainContext.watch(),
    scriptFileWorkerContext.watch(),
    ...rendererContexts.map((rendererContext) => rendererContext.watch()),
    preloadContext.watch(),
    sharedCssContext.watch(),
  ]);
  copyRendererFiles();
  watchRendererStaticFiles();
  watchLoaderSwf();
};

const run = isWatch ? watch : buildOnce;

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
