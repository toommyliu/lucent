import { randomFillSync } from "crypto";
import { existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";

import { app } from "electron";

import appBranding from "../../../appBranding.json";
import { parseCliOptions, type CliOptions } from "../cli";
import { type DesktopEnvironmentConfig } from "./DesktopEnvironment";
import {
  resolveFlashTrustRootPath,
  resolvePepperFlashPluginPath,
} from "../flash/FlashPaths";
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

export const resolveWorkspaceHome = (
  options: {
    readonly documentsPath?: string;
  } = {},
): string =>
  join(options.documentsPath ?? join(homedir(), "Documents"), "Lucent");

const resolveAppDataBasePath = (
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string => {
  if (platform === "win32") {
    return env["APPDATA"] ?? join(homedir(), "AppData", "Roaming");
  }

  if (platform === "darwin") {
    return join(homedir(), "Library", "Application Support");
  }

  return env["XDG_DATA_HOME"] ?? join(homedir(), ".local", "share");
};

export const resolveUserDataPath = (options: {
  readonly isDev: boolean;
  readonly platform?: NodeJS.Platform;
  readonly env?: NodeJS.ProcessEnv;
}): string => {
  const activeBranding = options.isDev
    ? appBranding.dev
    : appBranding.production;
  return join(
    resolveAppDataBasePath(options.platform, options.env),
    activeBranding.userDataDirName,
  );
};

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
    debug: cliOptions.debug === true || cliOptions.traceProjections === true,
    isDev,
    platform,
    traceProjections: cliOptions.traceProjections === true,
    workspaceDir: resolveWorkspaceHome({
      documentsPath: app.getPath("documents"),
    }),
  };
};

export const configureFlashStartup = (
  envConfig: DesktopEnvironmentConfig,
  options: {
    readonly flashPluginPathOverride?: string;
    readonly flashVersion?: string;
  } = {},
): FlashStartupResult => {
  const trustedPaths = [join(envConfig.assetsDir, "loader.swf")];
  const flashPluginPath = resolvePepperFlashPluginPath({
    ...(options.flashPluginPathOverride === undefined
      ? {}
      : { override: options.flashPluginPathOverride }),
    platform: envConfig.platform,
    workspaceDir: envConfig.workspaceDir,
  });
  const flashTrustRootPath = resolveFlashTrustRootPath(envConfig.appDataDir);
  const pluginMissing =
    flashPluginPath === null || !existsSync(flashPluginPath);

  if (!pluginMissing) {
    app.commandLine.appendSwitch("ppapi-flash-path", flashPluginPath);
    if (options.flashVersion !== undefined) {
      app.commandLine.appendSwitch("ppapi-flash-version", options.flashVersion);
    }
  }

  try {
    writeTrustFile({
      appName: "lucent",
      rootPath: flashTrustRootPath,
      trustedPaths,
    });
  } catch (cause) {
    return {
      status: "failed",
      cause,
      flashPluginPath,
      flashTrustRootPath,
      trustedPaths,
    };
  }

  if (pluginMissing) {
    return {
      status: "missing-plugin",
      flashPluginPath,
      flashTrustRootPath,
      trustedPaths,
    };
  }

  return {
    status: "configured",
    flashPluginPath,
    flashTrustRootPath,
    trustedPaths,
  };
};

export const prepareMainProcess = (): MainProcessBootstrap => {
  process.env["ELECTRON_DISABLE_SECURITY_WARNINGS"] = "true";
  installCryptoFallback();

  const cliOptions = parseMainCliOptions();
  const envConfig = resolveEnvironmentConfig(cliOptions);
  const flash = configureFlashStartup(envConfig, {
    ...(cliOptions.flashPluginPath === undefined
      ? {}
      : { flashPluginPathOverride: cliOptions.flashPluginPath }),
    ...(cliOptions.flashVersion === undefined
      ? {}
      : { flashVersion: cliOptions.flashVersion }),
  });
  return { cliOptions, envConfig, flash };
};
