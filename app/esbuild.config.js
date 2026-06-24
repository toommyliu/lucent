const { build, context } = require("esbuild");
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

const mainOptions = {
  ...baseOptions,
  entryPoints: ["src/main/index.ts"],
  external: ["electron"],
  format: "cjs",
  outfile: "dist/main/index.js",
  platform: "node",
  target: "node12",
};

const rendererOptions = {
  ...baseOptions,
  entryPoints: ["src/renderer/game/index.ts"],
  format: "esm",
  outfile: "dist/renderer/game/index.js",
  platform: "browser",
  target: "chrome87",
};

const copyRendererFiles = () => {
  mkdirSync("dist/renderer/game", { recursive: true });
  copyFileSync("src/renderer/game/index.html", "dist/renderer/game/index.html");
  copyFileSync("src/renderer/game/style.css", "dist/renderer/game/style.css");
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
  await Promise.all([build(mainOptions), build(rendererOptions)]);
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
  const rendererContext = await context({
    ...rendererOptions,
    plugins: [
      {
        name: "lucent-renderer-watch-copy",
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
  });

  await Promise.all([mainContext.watch(), rendererContext.watch()]);
  copyRendererFiles();
};

const run = isWatch ? watch : buildOnce;

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
