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
const MANAGED_PARTITION_PREFIX = "lucent-game-account-";
const STANDALONE_PARTITION_PREFIX = "lucent-game-standalone-";
const MANAGED_PARTITION_PATTERN = /^lucent-game-account-[a-f0-9]{64}$/;
const STANDALONE_PARTITION_PATTERN =
  /^lucent-game-standalone-([1-9][0-9]*)-([a-f0-9]{24})$/;
const RETIRED_PROFILE_MARKER = ".lucent-retired";

export type GamePartitionOwner =
  | { readonly kind: "managed-account"; readonly key: string }
  | { readonly kind: "standalone" };

export interface GamePartitionRegistry {
  readonly acquire: (owner: GamePartitionOwner) => string;
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
    !MANAGED_PARTITION_PATTERN.test(name) &&
    !STANDALONE_PARTITION_PATTERN.test(name)
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

const standaloneGamePartition = (
  processId: number,
  randomId: string,
): string => {
  if (!Number.isSafeInteger(processId) || processId <= 0) {
    throw new Error(`Invalid game partition process ID: ${processId}`);
  }
  if (!/^[a-f0-9]{24}$/.test(randomId)) {
    throw new Error(`Invalid game partition random ID: ${randomId}`);
  }
  return `${PERSISTENT_PARTITION_PREFIX}${STANDALONE_PARTITION_PREFIX}${processId}-${randomId}`;
};

/**
 * Managed accounts reuse only their own stable profile. Standalone and
 * duplicate-account views receive unique profiles that are never reused.
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

  const acquireStandalone = (): string => {
    let partition: string;
    do {
      partition = standaloneGamePartition(processId, makeRandomId());
    } while (inUse.has(partition));
    return partition;
  };

  return {
    acquire: (owner) => {
      const managedPartition =
        owner.kind === "managed-account"
          ? managedGamePartition(owner.key)
          : undefined;
      const partition =
        managedPartition !== undefined && !inUse.has(managedPartition)
          ? managedPartition
          : acquireStandalone();
      inUse.add(partition);
      return partition;
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
    const standaloneMatch = STANDALONE_PARTITION_PATTERN.exec(name);
    const removable =
      (MANAGED_PARTITION_PATTERN.test(name) &&
        existsSync(join(path, RETIRED_PROFILE_MARKER))) ||
      (standaloneMatch !== null && !isProcessAlive(Number(standaloneMatch[1])));
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
