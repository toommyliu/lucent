// https://github.com/electron/electron/issues/17972
const {
  chmodSync,
  existsSync,
  renameSync,
  statSync,
  writeFileSync,
} = require("node:fs");
const { join } = require("node:path");

exports.default = async function afterPackLinuxSandbox(context) {
  if (context.electronPlatformName !== "linux") {
    return;
  }

  const executableName = context.packager.executableName;
  const executablePath = join(context.appOutDir, executableName);
  const wrappedExecutablePath = `${executablePath}.bin`;

  if (!existsSync(executablePath)) {
    throw new Error(`Expected Linux executable at ${executablePath}`);
  }

  if (!existsSync(wrappedExecutablePath)) {
    renameSync(executablePath, wrappedExecutablePath);
  }

  if (!statSync(wrappedExecutablePath).isFile()) {
    throw new Error(
      `Expected wrapped Linux executable at ${wrappedExecutablePath}`,
    );
  }

  writeFileSync(
    executablePath,
    [
      "#!/usr/bin/env sh",
      "set -eu",
      'APP_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)',
      `exec "$APP_DIR/${executableName}.bin" --no-sandbox "$@"`,
      "",
    ].join("\n"),
  );
  chmodSync(executablePath, 0o755);
};
