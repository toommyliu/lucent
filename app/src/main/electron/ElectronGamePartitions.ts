import { createHash, randomBytes } from "crypto";
import {
  existsSync,
  readdirSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { join } from "path";

const PERSISTENT_PARTITION_PREFIX = "persist:";
const DEFAULT_PARTITION_NAME = "lucent-game-default";
const MANAGED_PARTITION_PREFIX = "lucent-game-account-";
const TEMPORARY_PARTITION_PREFIX = "lucent-game-temporary-";
const MANAGED_PARTITION_PATTERN = /^lucent-game-account-[a-f0-9]{64}$/;
const TEMPORARY_PARTITION_PATTERN =
  /^lucent-game-temporary-([1-9][0-9]*)-([a-f0-9]{24})$/;
/**
 * Electron may keep a Session alive after its game client closes, so account
 * deletion and identity-changing renames cannot safely remove the profile at
 * once. This marker schedules removal for the next cold start. Reopening the
 * same account before then cancels the removal.
 */
const RETIRED_PROFILE_MARKER = ".lucent-retired";

export type GamePartitionOwner =
  | { readonly kind: "default" }
  | { readonly kind: "managed-account"; readonly key: string };

export type GamePartitionLease =
  | {
      readonly kind: "persistent";
      readonly partition: string;
    }
  | {
      readonly kind: "temporary";
      readonly partition: string;
      readonly sourcePartition: string;
    };

export interface GamePartitionRegistry {
  readonly acquire: (owner: GamePartitionOwner) => GamePartitionLease;
  readonly release: (partition: string) => void;
}

export interface GamePartitionCleanupResult {
  readonly failedPaths: readonly string[];
  readonly removedPaths: readonly string[];
}

const partitionName = (partition: string): string => {
  if (!partition.startsWith(PERSISTENT_PARTITION_PREFIX)) {
    throw new Error(`Invalid game partition: ${partition}`);
  }
  const name = partition.slice(PERSISTENT_PARTITION_PREFIX.length);
  if (
    name !== DEFAULT_PARTITION_NAME &&
    !MANAGED_PARTITION_PATTERN.test(name) &&
    !TEMPORARY_PARTITION_PATTERN.test(name)
  ) {
    throw new Error(`Invalid game partition: ${partition}`);
  }
  return name;
};

const normalizeManagedAccountKey = (key: string): string => {
  const normalized = key.trim().toLowerCase();
  if (normalized === "") {
    throw new Error("Managed game partition key cannot be empty.");
  }
  return normalized;
};

export const managedGamePartition = (key: string): string => {
  const digest = createHash("sha256")
    .update(normalizeManagedAccountKey(key), "utf8")
    .digest("hex");
  return `${PERSISTENT_PARTITION_PREFIX}${MANAGED_PARTITION_PREFIX}${digest}`;
};

export const defaultGamePartition = `${PERSISTENT_PARTITION_PREFIX}${DEFAULT_PARTITION_NAME}`;

const temporaryGamePartition = (
  processId: number,
  randomId: string,
): string => {
  if (!Number.isSafeInteger(processId) || processId <= 0) {
    throw new Error(`Invalid game partition process ID: ${processId}`);
  }
  if (!/^[a-f0-9]{24}$/.test(randomId)) {
    throw new Error(`Invalid game partition random ID: ${randomId}`);
  }
  return `${PERSISTENT_PARTITION_PREFIX}${TEMPORARY_PARTITION_PREFIX}${processId}-${randomId}`;
};

/**
 * Chromium 87 reuses a PPAPI process when the plugin path and profile data
 * directory match and the origin lock is compatible. Lucent gives every live
 * client a distinct Electron partition and profile directory, so Chromium
 * starts a separate Pepper Flash process instead of concentrating their work in
 * one.
 * This avoids the shared-process bottleneck at the cost of more memory in both
 * tabs and separate windows.
 *
 * Each owner leases its persistent profile exclusively. Concurrent clients
 * receive temporary profiles cloned by ElectronSession and never write back.
 *
 * @see https://chromium.googlesource.com/chromium/src/+/refs/tags/87.0.4280.141/content/browser/plugin_service_impl.cc#132
 */
export const makeGamePartitionRegistry = (
  options: {
    readonly makeRandomId?: () => string;
    readonly processId?: number;
  } = {},
): GamePartitionRegistry => {
  const inUse = new Set<string>();
  const makeRandomId =
    options.makeRandomId ?? (() => randomBytes(12).toString("hex"));
  const processId = options.processId ?? process.pid;

  const acquireTemporary = (): string => {
    let partition: string;
    do {
      partition = temporaryGamePartition(processId, makeRandomId());
    } while (inUse.has(partition));
    return partition;
  };

  return {
    acquire: (owner) => {
      const persistentPartition =
        owner.kind === "managed-account"
          ? managedGamePartition(owner.key)
          : defaultGamePartition;
      if (!inUse.has(persistentPartition)) {
        inUse.add(persistentPartition);
        return { kind: "persistent", partition: persistentPartition };
      }

      const partition = acquireTemporary();
      inUse.add(partition);
      return {
        kind: "temporary",
        partition,
        sourcePartition: persistentPartition,
      };
    },
    release: (partition) => {
      inUse.delete(partition);
    },
  };
};

export const resolveGamePartitionProfilePath = (
  appDataDir: string,
  partition: string,
): string => join(appDataDir, "Partitions", partitionName(partition));

const partitionsDirectory = (appDataDir: string): string =>
  join(appDataDir, "Partitions");

const isMissing = (cause: unknown): boolean =>
  cause instanceof Error &&
  "code" in cause &&
  (cause as { readonly code?: unknown }).code === "ENOENT";

const directoryNames = (path: string): readonly string[] => {
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch (cause) {
    if (isMissing(cause)) return [];
    throw cause;
  }
};

const removeDirectoryTree = (path: string): void => {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const childPath = join(path, entry.name);
    if (entry.isDirectory()) {
      removeDirectoryTree(childPath);
    } else {
      unlinkSync(childPath);
    }
  }
  rmdirSync(path);
};

const defaultProcessIsAlive = (processId: number): boolean => {
  try {
    process.kill(processId, 0);
    return true;
  } catch (cause) {
    return (
      cause instanceof Error &&
      "code" in cause &&
      (cause as { readonly code?: unknown }).code === "EPERM"
    );
  }
};

/** Removes only profiles that cannot belong to a live game session. */
export const cleanupStaleGamePartitionProfiles = (
  appDataDir: string,
  options: {
    readonly isProcessAlive?: (processId: number) => boolean;
  } = {},
): GamePartitionCleanupResult => {
  const directory = partitionsDirectory(appDataDir);
  const isProcessAlive = options.isProcessAlive ?? defaultProcessIsAlive;
  const failedPaths: string[] = [];
  const removedPaths: string[] = [];

  for (const name of directoryNames(directory)) {
    const path = join(directory, name);
    const temporaryMatch = TEMPORARY_PARTITION_PATTERN.exec(name);
    const removable =
      (MANAGED_PARTITION_PATTERN.test(name) &&
        existsSync(join(path, RETIRED_PROFILE_MARKER))) ||
      (temporaryMatch !== null && !isProcessAlive(Number(temporaryMatch[1])));
    if (!removable) continue;

    try {
      removeDirectoryTree(path);
      removedPaths.push(path);
    } catch {
      failedPaths.push(path);
    }
  }

  return { failedPaths, removedPaths };
};

export const activateManagedGamePartitionProfile = (
  profilePath: string,
): void => {
  const markerPath = join(profilePath, RETIRED_PROFILE_MARKER);
  try {
    unlinkSync(markerPath);
  } catch (cause) {
    if (!isMissing(cause)) throw cause;
  }
};

export const retireManagedGamePartitionProfile = (
  appDataDir: string,
  key: string,
): boolean => {
  const profilePath = resolveGamePartitionProfilePath(
    appDataDir,
    managedGamePartition(key),
  );
  if (!existsSync(profilePath)) return false;
  writeFileSync(join(profilePath, RETIRED_PROFILE_MARKER), "1\n", "utf8");
  return true;
};
