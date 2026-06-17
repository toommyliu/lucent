import { randomFillSync } from "crypto";
import { app } from "electron";
import { existsSync } from "fs";
import { join } from "path";
import appBranding from "../../../appBranding.json";
import { parseCliOptions, type CliOptions } from "../cli";
import { trustOnlySync } from "../flash/FlashTrust";
import {
  makeDesktopEnvironment,
  resolveUserDataPath,
  resolveWorkspaceHome,
  type DesktopEnvironmentConfig,
} from "./DesktopEnvironment";
import type { EarlyFlashSetupResult } from "./DesktopApp";

export interface MainProcessBootstrap {
  readonly cliOptions: CliOptions;
  readonly envConfig: DesktopEnvironmentConfig;
  readonly earlyFlashSetup: EarlyFlashSetupResult;
}

const installMainCryptoFallback = (): void => {
  if (globalThis.crypto !== undefined) {
    return;
  }

  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: {
      getRandomValues: <T extends ArrayBufferView>(array: T): T => {
        randomFillSync(
          Buffer.from(array.buffer, array.byteOffset, array.byteLength),
        );
        return array;
      },
    },
  });
};

const parseMainCliOptions = (): CliOptions => {
  try {
    return parseCliOptions(process.argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Invalid CLI options: ${message}\n`);
    app.exit(1);
    throw error;
  }
};

const resolveEnvironmentConfig = (
  cliOptions: CliOptions,
): DesktopEnvironmentConfig => {
  const isDev = !app.isPackaged;
  const isDarwin = process.platform === "darwin";
  const isWin = process.platform === "win32";
  const isLinux = process.platform === "linux";
  const activeBranding = isDev ? appBranding.dev : appBranding.production;

  const userDataPath = resolveUserDataPath({ isDev });
  app.setPath("userData", userDataPath);
  app.setName(activeBranding.displayName);

  if (isWin) {
    app.setAppUserModelId(activeBranding.bundleId);
  }

  return {
    appDataDir: app.getPath("userData"),
    workspaceDir: resolveWorkspaceHome({
      argv: process.argv,
      documentsPath: app.getPath("documents"),
    }),
    assetsDir: join(app.getAppPath(), "..", "assets"),
    rendererDir: join(__dirname, "../renderer"),
    preloadPath: join(__dirname, "../preload/index.js"),
    ...(process.env["LUCENT_DEV_RENDERER_RELOAD"] === undefined
      ? {}
      : { devRendererReloadPath: process.env["LUCENT_DEV_RENDERER_RELOAD"] }),
    ...(cliOptions.flashPluginPath === undefined
      ? {}
      : { flashPluginPathOverride: cliOptions.flashPluginPath }),
    isDev,
    isDarwin,
    isWin,
    isLinux,
  };
};

const configureFlashSupport = (
  envConfig: DesktopEnvironmentConfig,
): EarlyFlashSetupResult => {
  const earlyEnvironment = makeDesktopEnvironment(envConfig);
  const trustedPaths = [join(earlyEnvironment.assetsDir, "loader.swf")];
  const flashPluginPath = earlyEnvironment.flashPluginPath;
  const isFlashPluginMissing =
    flashPluginPath === null || !existsSync(flashPluginPath);

  if (flashPluginPath && !isFlashPluginMissing) {
    app.commandLine.appendSwitch("ppapi-flash-path", flashPluginPath);
  }

  try {
    trustOnlySync("lucent", trustedPaths, {
      customFolder: earlyEnvironment.flashRootPath,
    });
    if (isFlashPluginMissing) {
      return {
        status: "missing-plugin",
        flashPluginPath,
        flashRootPath: earlyEnvironment.flashRootPath,
        trustedPaths,
      };
    }

    return {
      status: "configured",
      flashPluginPath,
      flashRootPath: earlyEnvironment.flashRootPath,
      trustedPaths,
    };
  } catch (cause) {
    return {
      status: "failed",
      cause,
      flashPluginPath,
      flashRootPath: earlyEnvironment.flashRootPath,
      trustedPaths,
    };
  }
};

export const prepareMainProcess = (): MainProcessBootstrap => {
  process.env["ELECTRON_DISABLE_SECURITY_WARNINGS"] = "true";
  installMainCryptoFallback();

  const cliOptions = parseMainCliOptions();
  const envConfig = resolveEnvironmentConfig(cliOptions);
  const earlyFlashSetup = configureFlashSupport(envConfig);

  return {
    cliOptions,
    envConfig,
    earlyFlashSetup,
  };
};
