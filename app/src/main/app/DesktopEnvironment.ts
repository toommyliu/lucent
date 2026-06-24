import { homedir } from "os";
import { join } from "path";

import { Context, Layer } from "effect";

import appBranding from "../../../appBranding.json";

export interface DesktopEnvironmentConfig {
  readonly appDataDir: string;
  readonly assetsDir: string;
  readonly flashPluginPathOverride?: string;
  readonly isDev: boolean;
  readonly platform: NodeJS.Platform;
  readonly rendererDir: string;
  readonly workspaceDir: string;
}

export interface DesktopEnvironmentShape extends DesktopEnvironmentConfig {
  readonly appDataPath: (...parts: readonly string[]) => string;
  readonly workspacePath: (...parts: readonly string[]) => string;
  readonly appIconPath: string;
  readonly flashPluginPath: string | null;
  readonly flashTrustRootPath: string;
  readonly gameHtmlPath: string;
  readonly logFilePath: string;
  readonly logsDir: string;
  readonly releaseCachePath: string;
  readonly settingsPath: string;
}

export class DesktopEnvironment extends Context.Service<
  DesktopEnvironment,
  DesktopEnvironmentShape
>()("lucent/desktop/app/DesktopEnvironment") {}

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

const resolvePepperFlashPluginPath = (
  workspaceDir: string,
  platform: NodeJS.Platform = process.platform,
): string | null => {
  if (platform === "darwin") {
    return join(workspaceDir, "PepperFlashPlayer.plugin");
  }

  if (platform === "win32") {
    return join(workspaceDir, "pepflashplayer.dll");
  }

  if (platform === "linux") {
    return join(workspaceDir, "libpepflashplayer.so");
  }

  return null;
};

const resolveFlashTrustRootPath = (appDataDir: string): string =>
  join(appDataDir, "Pepper Data", "Shockwave Flash", "WritableRoot");

export const makeDesktopEnvironment = (
  config: DesktopEnvironmentConfig,
): DesktopEnvironmentShape => {
  const appDataPath = (...parts: readonly string[]) =>
    join(config.appDataDir, ...parts);
  const workspacePath = (...parts: readonly string[]) =>
    join(config.workspaceDir, ...parts);
  const activeBranding = config.isDev
    ? appBranding.dev
    : appBranding.production;

  const logsDir = appDataPath("logs");

  return {
    ...config,
    appDataPath,
    workspacePath,
    appIconPath: join(config.assetsDir, activeBranding.iconPng),
    flashPluginPath:
      config.flashPluginPathOverride ??
      resolvePepperFlashPluginPath(config.workspaceDir, config.platform),
    flashTrustRootPath: resolveFlashTrustRootPath(config.appDataDir),
    gameHtmlPath: join(config.rendererDir, "game", "index.html"),
    logFilePath: join(logsDir, "lucent.log"),
    logsDir,
    releaseCachePath: appDataPath("release-cache.json"),
    settingsPath: appDataPath("settings.json"),
  };
};

export const layer = (config: DesktopEnvironmentConfig) =>
  Layer.succeed(DesktopEnvironment, makeDesktopEnvironment(config));
