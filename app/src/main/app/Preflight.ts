import { randomFillSync } from "crypto";
import { existsSync } from "fs";
import { join } from "path";

import { app } from "electron";

import appBranding from "../../../appBranding.json";
import { parseCliOptions, type CliOptions } from "../cli";
import {
  makeDesktopEnvironment,
  resolveUserDataPath,
  resolveWorkspaceHome,
  type DesktopEnvironmentConfig,
} from "./DesktopEnvironment";
import { writeTrustFile } from "../flash/FlashTrust";

export type FlashStartupResult =
  | {
      readonly status: "configured";
      readonly flashPluginPath: string;
      readonly flashTrustRootPath: string;
      readonly trustedPaths: readonly string[];
    }
  | {
      readonly status: "missing-plugin";
      readonly flashPluginPath: string | null;
      readonly flashTrustRootPath: string;
      readonly trustedPaths: readonly string[];
    }
  | {
      readonly status: "failed";
      readonly cause: unknown;
      readonly flashPluginPath: string | null;
      readonly flashTrustRootPath: string;
      readonly trustedPaths: readonly string[];
    };

export interface MainProcessBootstrap {
  readonly cliOptions: CliOptions;
  readonly envConfig: DesktopEnvironmentConfig;
  readonly flash: FlashStartupResult;
}

const installCryptoFallback = (): void => {
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

const parseMainCliOptions = (): CliOptions => parseCliOptions(process.argv);

const resolveEnvironmentConfig = (
  cliOptions: CliOptions,
): DesktopEnvironmentConfig => {
  const isDev = !app.isPackaged;
  const platform = process.platform;
  const activeBranding = isDev ? appBranding.dev : appBranding.production;
  const appDataDir = resolveUserDataPath({ isDev, platform });

  app.setPath("userData", appDataDir);
  app.setName(activeBranding.displayName);
  if (platform === "win32") {
    app.setAppUserModelId(activeBranding.bundleId);
  }

  return {
    appDataDir: app.getPath("userData"),
    assetsDir: join(app.getAppPath(), "..", "assets"),
    ...(cliOptions.flashPluginPath === undefined
      ? {}
      : { flashPluginPathOverride: cliOptions.flashPluginPath }),
    isDev,
    platform,
    rendererDir: join(__dirname, "../renderer"),
    workspaceDir: resolveWorkspaceHome({
      documentsPath: app.getPath("documents"),
    }),
  };
};

export const configureFlashStartup = (
  envConfig: DesktopEnvironmentConfig,
): FlashStartupResult => {
  const env = makeDesktopEnvironment(envConfig);
  const trustedPaths = [join(env.assetsDir, "loader.swf")];
  const flashPluginPath = env.flashPluginPath;
  const pluginMissing =
    flashPluginPath === null || !existsSync(flashPluginPath);

  if (!pluginMissing) {
    app.commandLine.appendSwitch("ppapi-flash-path", flashPluginPath);
  }

  try {
    writeTrustFile({
      appName: "lucent",
      rootPath: env.flashTrustRootPath,
      trustedPaths,
    });
  } catch (cause) {
    return {
      status: "failed",
      cause,
      flashPluginPath,
      flashTrustRootPath: env.flashTrustRootPath,
      trustedPaths,
    };
  }

  if (pluginMissing) {
    return {
      status: "missing-plugin",
      flashPluginPath,
      flashTrustRootPath: env.flashTrustRootPath,
      trustedPaths,
    };
  }

  return {
    status: "configured",
    flashPluginPath,
    flashTrustRootPath: env.flashTrustRootPath,
    trustedPaths,
  };
};

export const prepareMainProcess = (): MainProcessBootstrap => {
  process.env["ELECTRON_DISABLE_SECURITY_WARNINGS"] = "true";
  installCryptoFallback();

  const cliOptions = parseMainCliOptions();
  const envConfig = resolveEnvironmentConfig(cliOptions);
  const flash = configureFlashStartup(envConfig);
  return { cliOptions, envConfig, flash };
};
