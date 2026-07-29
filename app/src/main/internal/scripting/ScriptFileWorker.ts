/* oxlint-disable unicorn/require-post-message-target-origin */
import "../../../shared/generated/polyfills.node";

import { createHash } from "crypto";
import { createReadStream, promises as fs } from "fs";
import { basename } from "path";
import { parentPort } from "worker_threads";

import * as Effect from "effect/Effect";

import type {
  ScriptFileResolution,
  ScriptInputsDefinition,
} from "@lucent/core/scriptInputs";
import { extractScriptInputs } from "./ScriptInputsExtractor";
import {
  SCRIPT_FILE_MAX_BYTES,
  type ScriptFileWorkerRequest,
  type ScriptFileWorkerResponse,
} from "./ScriptFileWorkerProtocol";

const extractionCacheLimit = 64;
const extractionCacheMaxBytes = 32 * 1024 * 1024;
interface ExtractionCacheEntry {
  readonly inputs: ScriptInputsDefinition | null;
  readonly weight: number;
}
const extractionCache = new Map<string, ExtractionCacheEntry>();
let extractionCacheBytes = 0;

const errorCode = (error: unknown): string | undefined => {
  if (typeof error !== "object" || error === null) return undefined;
  const code = Reflect.get(error, "code");
  return typeof code === "string" ? code : undefined;
};

const errorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message.trim() !== "") {
    return error.message;
  }
  return typeof error === "string" && error.trim() !== ""
    ? error
    : "Script file processing failed.";
};

const errorDetailsText = (error: unknown): string | undefined =>
  error instanceof Error && error.stack?.trim() !== ""
    ? error.stack
    : undefined;

const failed = (path: string, error: unknown): ScriptFileResolution => {
  const detailsText = errorDetailsText(error);
  return {
    status: "failed",
    path,
    message: errorMessage(error),
    ...(detailsText === undefined ? {} : { detailsText }),
  };
};

const isMissingError = (error: unknown): boolean => {
  const code = errorCode(error);
  return code === "ENOENT" || code === "ENOTDIR";
};

const fingerprint = (stat: Awaited<ReturnType<typeof fs.stat>>): string =>
  [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs].join(":");

const assertFileSize = (path: string, size: number): void => {
  if (size > SCRIPT_FILE_MAX_BYTES) {
    throw new Error(`Script file exceeds the 16 MiB limit: ${path}.`);
  }
};

const readBoundedFile = async (path: string): Promise<Buffer> => {
  const stream = createReadStream(path, { highWaterMark: 64 * 1024 });
  const chunks: Buffer[] = [];
  let size = 0;

  try {
    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.byteLength;
      assertFileSize(path, size);
      chunks.push(buffer);
    }
  } finally {
    stream.destroy();
  }

  return Buffer.concat(chunks, size);
};

const readStableFile = async (
  path: string,
): Promise<Buffer | { readonly missing: true }> => {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let before: Awaited<ReturnType<typeof fs.stat>>;
    try {
      before = await fs.stat(path);
    } catch (error) {
      if (isMissingError(error)) return { missing: true };
      throw error;
    }

    assertFileSize(path, before.size);
    const contents = await readBoundedFile(path);
    assertFileSize(path, contents.byteLength);

    let after: Awaited<ReturnType<typeof fs.stat>>;
    try {
      after = await fs.stat(path);
    } catch (error) {
      if (isMissingError(error)) continue;
      throw error;
    }

    if (fingerprint(before) === fingerprint(after)) return contents;
  }

  throw new Error(`Script file changed while it was being read: ${path}.`);
};

const cachedInputs = async (
  source: string,
  path: string,
  revision: string,
): Promise<ScriptInputsDefinition | null> => {
  const key = `${revision}:${path}`;
  const cached = extractionCache.get(key);
  if (cached !== undefined) {
    extractionCache.delete(key);
    extractionCache.set(key, cached);
    return cached.inputs;
  }

  const inputs = await Effect.runPromise(extractScriptInputs(source, path));
  const entry: ExtractionCacheEntry = {
    inputs,
    weight: Buffer.byteLength(source, "utf8"),
  };
  extractionCache.set(key, entry);
  extractionCacheBytes += entry.weight;
  while (
    extractionCache.size > extractionCacheLimit ||
    extractionCacheBytes > extractionCacheMaxBytes
  ) {
    const oldestKey = extractionCache.keys().next().value;
    if (oldestKey === undefined) break;
    const oldest = extractionCache.get(oldestKey);
    extractionCache.delete(oldestKey);
    extractionCacheBytes -= oldest?.weight ?? 0;
  }
  return inputs;
};

export const processScriptFile = async (
  path: string,
): Promise<ScriptFileResolution> => {
  try {
    const contents = await readStableFile(path);
    if ("missing" in contents) return { status: "missing", path };

    const source = contents.toString("utf8");
    const revision = createHash("sha256").update(contents).digest("hex");
    const inputs = await cachedInputs(source, path, revision);
    return {
      status: "found",
      file: {
        inputs,
        name: basename(path),
        path,
        revision,
        source,
      },
    };
  } catch (error) {
    return isMissingError(error)
      ? { status: "missing", path }
      : failed(path, error);
  }
};

const workerPort = parentPort;
if (workerPort !== null) {
  workerPort.on("message", (request: ScriptFileWorkerRequest) => {
    void processScriptFile(request.path).then((resolution) => {
      workerPort.postMessage({
        id: request.id,
        resolution,
      } satisfies ScriptFileWorkerResponse);
    });
  });
}
