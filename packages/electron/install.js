#!/usr/bin/env node

const { downloadArtifact } = require("@electron/get");

const childProcess = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { version } = require("./package");

const distPath =
  process.env.ELECTRON_OVERRIDE_DIST_PATH || path.join(__dirname, "dist");
const pathFile = path.join(__dirname, "path.txt");
const versionFile = path.join(distPath, "version");

if (process.env.ELECTRON_SKIP_BINARY_DOWNLOAD) {
  process.exit(0);
}

const platformPath = getPlatformPath();

if (isInstalled()) {
  process.exit(0);
}

resetInstallState();

const platform = getPlatform();
const arch = "x64";

// if (
//   platform === 'darwin' &&
//   process.platform === 'darwin' &&
//   arch === 'x64' &&
//   process.env.npm_config_arch === undefined
// ) {
//   // When downloading for macOS ON macOS and we think we need x64 we should
//   // check if we're running under rosetta and download the arm64 version if appropriate
//   try {
//     const output = childProcess.execSync('sysctl -in sysctl.proc_translated');
//     if (output.toString().trim() === '1') {
//       arch = 'arm64';
//     }
//   } catch {
//     // Ignore failure
//   }
// }

// downloads if not cached
downloadArtifact({
  version,
  artifactName: "electron",
  force: process.env.force_no_cache === "true",
  cacheRoot: process.env.electron_config_cache,
  // checksums:
  //   (process.env.electron_use_remote_checksums ??
  //   process.env.npm_config_electron_use_remote_checksums)
  //     ? undefined
  //     : require('./checksums.json'),
  platform,
  arch,
})
  .then(extractFile)
  .catch((err) => {
    console.error(err.stack);
    process.exit(1);
  });

function isInstalled() {
  try {
    if (fs.readFileSync(pathFile, "utf-8") !== platformPath) {
      return false;
    }

    validateInstalledRuntime();

    return true;
  } catch {
    return false;
  }
}

function resetInstallState() {
  fs.rmSync(pathFile, { force: true });

  if (!process.env.ELECTRON_OVERRIDE_DIST_PATH) {
    fs.rmSync(distPath, { recursive: true, force: true });
  }
}

function runChecked(command, args) {
  const result = childProcess.spawnSync(command, args, {
    encoding: "utf8",
    stdio: "pipe",
  });

  if (result.status === 0) {
    return;
  }

  const details = [result.error?.message, result.stdout, result.stderr]
    .filter(Boolean)
    .join("\n");
  throw new Error(
    `Failed to run ${command} ${args.join(" ")}: ${details}`.trim(),
  );
}

function quotePowerShellLiteral(value) {
  return `'${value.replace(/'/g, "''")}'`;
}

function extractArchive(zipPath) {
  fs.mkdirSync(distPath, { recursive: true });

  if (process.platform === "darwin") {
    runChecked("ditto", ["-x", "-k", zipPath, distPath]);
    return;
  }

  if (process.platform === "win32") {
    runChecked("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      [
        "Expand-Archive",
        "-LiteralPath",
        quotePowerShellLiteral(zipPath),
        "-DestinationPath",
        quotePowerShellLiteral(distPath),
        "-Force",
      ].join(" "),
    ]);
    return;
  }

  runChecked("unzip", ["-q", zipPath, "-d", distPath]);
}

function validateInstalledRuntime() {
  if (fs.readFileSync(versionFile, "utf8").replace(/^v/, "") !== version) {
    throw new Error(`Electron dist version does not match ${version}`);
  }

  const electronPath = path.join(distPath, platformPath);
  if (!fs.existsSync(electronPath)) {
    throw new Error(`Electron executable is missing at ${electronPath}`);
  }

  if (getPlatform() === "darwin") {
    const appBundlePath = path.join(distPath, "Electron.app");
    const requiredPaths = [
      path.join(appBundlePath, "Contents", "Info.plist"),
      path.join(appBundlePath, "Contents", "Resources"),
      path.join(appBundlePath, "Contents", "Frameworks"),
    ];

    for (const requiredPath of requiredPaths) {
      if (!fs.existsSync(requiredPath)) {
        throw new Error(`Electron app bundle is missing ${requiredPath}`);
      }
    }
  }
}

// unzips and makes path.txt point at the correct executable
function extractFile(zipPath) {
  extractArchive(zipPath);

  // If the zip contains an "electron.d.ts" file, move that up.
  const srcTypeDefPath = path.join(distPath, "electron.d.ts");
  const targetTypeDefPath = path.join(__dirname, "electron.d.ts");
  const hasTypeDefinitions = fs.existsSync(srcTypeDefPath);

  if (hasTypeDefinitions) {
    fs.renameSync(srcTypeDefPath, targetTypeDefPath);
  }

  fs.writeFileSync(versionFile, version);
  validateInstalledRuntime();
  fs.writeFileSync(pathFile, platformPath);
}

function getPlatform() {
  return process.env.npm_config_platform || os.platform();
}

function getPlatformPath() {
  switch (getPlatform()) {
    case "mas":
    case "darwin":
      return "Electron.app/Contents/MacOS/Electron";
    case "freebsd":
    case "openbsd":
    case "linux":
      return "electron";
    case "win32":
      return "electron.exe";
    default:
      throw new Error(
        "Electron builds are not available on platform: " + getPlatform(),
      );
  }
}
