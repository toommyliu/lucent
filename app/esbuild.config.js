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
} = require("fs");
const { dirname, join } = require("path");

const isProduction = process.env.NODE_ENV === "production";
const isWatch = process.argv.includes("--watch") || process.argv.includes("-w");
const skipInitialBuildNotify =
  process.env.LUCENT_DEV_BUILD_NOTIFY_SKIP_INITIAL === "1";
const notifiedLabels = new Set();

const baseOptions = {
  bundle: true,
  logLevel: "info",
  minify: isProduction,
  sourcemap: !isProduction,
};

const rendererViews = [
  {
    entryPoint: "src/renderer/game/index.ts",
    id: "game",
  },
  {
    entryPoint: "src/renderer/settings/index.tsx",
    id: "settings",
    plugins: [solidPlugin()],
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
  ...(view.plugins === undefined ? {} : { plugins: view.plugins }),
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

const copyRendererFiles = () => {
  for (const view of rendererViews) {
    const sourceDir = `src/renderer/${view.id}`;
    const targetDir = `dist/renderer/${view.id}`;
    mkdirSync(targetDir, { recursive: true });
    copyFileSync(`${sourceDir}/index.html`, `${targetDir}/index.html`);

    const stylePath = `${sourceDir}/style.css`;
    if (existsSync(stylePath)) {
      copyFileSync(stylePath, `${targetDir}/style.css`);
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

const notifyBuild = (label) => {
  const notifyPath = process.env.LUCENT_DEV_BUILD_NOTIFY;
  if (!notifyPath) {
    return;
  }

  if (skipInitialBuildNotify && !notifiedLabels.has(label)) {
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
};

const run = isWatch ? watch : buildOnce;

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
