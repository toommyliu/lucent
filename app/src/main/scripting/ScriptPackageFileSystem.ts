import { createHash } from "crypto";
import { createReadStream, promises as fs } from "fs";
import { relative, resolve, sep } from "path";

export const SCRIPT_MODULE_MAX_BYTES = 16 * 1024 * 1024;
export const SCRIPT_SNAPSHOT_MAX_BYTES = 64 * 1024 * 1024;
export const SCRIPT_PACKAGE_MAX_FILES = 10_000;

export interface FileInventoryEntry {
  readonly absolutePath: string;
  readonly fingerprint: string;
  readonly relativePath: string;
  readonly size: number;
}

export interface RegularFilePath {
  readonly absolutePath: string;
  readonly relativePath: string;
}

export interface StableFileContents {
  readonly contents: Buffer;
  readonly fingerprint: string;
}

interface ListRegularFilesOptions {
  readonly maxFiles?: number;
  readonly rejectSymlinks?: boolean;
}

const errorCode = (cause: unknown): string | undefined =>
  cause instanceof Error && "code" in cause
    ? String((cause as { readonly code?: unknown }).code)
    : undefined;

const systemMetadataNames = new Set(["desktop.ini", "thumbs.db"]);

const isSystemMetadataFile = (name: string): boolean =>
  name === ".DS_Store" ||
  name === ".directory" ||
  name.startsWith("._") ||
  systemMetadataNames.has(name.toLowerCase());

export const isMissingFileError = (cause: unknown): boolean => {
  const code = errorCode(cause);
  return code === "ENOENT" || code === "ENOTDIR";
};

export const portablePath = (value: string): string =>
  value.split(sep).join("/");

export const isPathInside = (root: string, candidate: string): boolean => {
  const normalizedRoot = resolve(root);
  const normalizedCandidate = resolve(candidate);
  const path = relative(normalizedRoot, normalizedCandidate);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== "..");
};

const fingerprint = (stat: Awaited<ReturnType<typeof fs.stat>>): string =>
  [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs].join(":");

const assertSize = (path: string, size: number, maxBytes: number): void => {
  if (size > maxBytes) {
    throw new Error(`File exceeds the ${maxBytes} byte limit: ${path}.`);
  }
};

export const readStableFileWithFingerprint = async (
  path: string,
  maxBytes = SCRIPT_MODULE_MAX_BYTES,
): Promise<StableFileContents> => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const before = await fs.stat(path);
    if (!before.isFile()) throw new Error(`Expected a regular file: ${path}.`);
    assertSize(path, before.size, maxBytes);

    const stream = createReadStream(path, { highWaterMark: 64 * 1024 });
    const chunks: Buffer[] = [];
    let bytes = 0;
    try {
      for await (const chunk of stream) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += buffer.byteLength;
        assertSize(path, bytes, maxBytes);
        chunks.push(buffer);
      }
    } finally {
      stream.destroy();
    }

    const after = await fs.stat(path);
    if (fingerprint(before) === fingerprint(after)) {
      return {
        contents: Buffer.concat(chunks, bytes),
        fingerprint: fingerprint(after),
      };
    }
  }

  throw new Error(`File changed while it was being read: ${path}.`);
};

export const readStableFile = async (
  path: string,
  maxBytes = SCRIPT_MODULE_MAX_BYTES,
): Promise<Buffer> =>
  (await readStableFileWithFingerprint(path, maxBytes)).contents;

export const regularFileFingerprint = async (path: string): Promise<string> => {
  const stat = await fs.stat(path);
  if (!stat.isFile()) throw new Error(`Expected a regular file: ${path}.`);
  return fingerprint(stat);
};

export const sha256Revision = (contents: Buffer | string): string =>
  createHash("sha256").update(contents).digest("hex");

async function collectRegularFiles(
  root: string,
  options: ListRegularFilesOptions,
  includeMetadata: true,
): Promise<readonly FileInventoryEntry[]>;
async function collectRegularFiles(
  root: string,
  options: ListRegularFilesOptions,
  includeMetadata: false,
): Promise<readonly RegularFilePath[]>;
async function collectRegularFiles(
  root: string,
  options: ListRegularFilesOptions,
  includeMetadata: boolean,
): Promise<readonly (FileInventoryEntry | RegularFilePath)[]> {
  const files: (FileInventoryEntry | RegularFilePath)[] = [];

  const visit = async (directory: string): Promise<void> => {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((left, right) =>
      left.name.localeCompare(right.name, undefined, {
        numeric: true,
        sensitivity: "base",
      }),
    );

    for (const entry of entries) {
      const path = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) {
        if (options.rejectSymlinks === true) {
          throw new Error(`Symbolic links are not supported: ${path}.`);
        }
        continue;
      }
      if (entry.isDirectory()) {
        await visit(path);
        continue;
      }
      if (!entry.isFile()) continue;
      if (isSystemMetadataFile(entry.name)) continue;

      const relativePath = portablePath(relative(root, path));
      if (includeMetadata) {
        const stat = await fs.stat(path);
        files.push({
          absolutePath: path,
          fingerprint: fingerprint(stat),
          relativePath,
          size: stat.size,
        });
      } else {
        files.push({ absolutePath: path, relativePath });
      }
      if (options.maxFiles !== undefined && files.length > options.maxFiles) {
        throw new Error(
          `Directory contains more than ${options.maxFiles} files: ${root}.`,
        );
      }
    }
  };

  try {
    await visit(root);
  } catch (cause) {
    if (isMissingFileError(cause)) return [];
    throw cause;
  }
  return files;
}

export const listRegularFilePaths = (
  root: string,
  options: ListRegularFilesOptions = {},
): Promise<readonly RegularFilePath[]> =>
  collectRegularFiles(root, options, false);

export const listRegularFiles = (
  root: string,
  options: ListRegularFilesOptions = {},
): Promise<readonly FileInventoryEntry[]> =>
  collectRegularFiles(root, options, true);

export const hashDirectory = async (
  root: string,
): Promise<Readonly<Record<string, string>>> => {
  const inventory = await listRegularFiles(root, {
    maxFiles: SCRIPT_PACKAGE_MAX_FILES,
    rejectSymlinks: true,
  });
  const hashes: Record<string, string> = {};
  for (const file of inventory) {
    const contents = await readStableFile(
      file.absolutePath,
      SCRIPT_SNAPSHOT_MAX_BYTES,
    );
    hashes[file.relativePath] = `sha256-${sha256Revision(contents)}`;
  }
  return hashes;
};
