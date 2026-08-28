import { mkdtemp, rm, stat, truncate, utimes, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join, resolve as resolvePath } from "path";
import { EventEmitter } from "events";
import type { Worker } from "worker_threads";

import { afterEach, describe, expect, it } from "vitest";

import { makeScriptFileResolver, ScriptFileWorkerClient } from "./ScriptFiles";
import { processScriptFile } from "./ScriptFileWorker";
import type { ScriptFileAnalysisResolution } from "./ScriptFileWorkerProtocol";
import { SCRIPT_FILE_MAX_BYTES } from "../../scripting/ScriptLimits";

const tempDirectories = new Set<string>();

class FakeWorker extends EventEmitter {
  readonly messages: unknown[] = [];

  postMessage(message: unknown): void {
    this.messages.push(message);
  }

  terminate(): Promise<number> {
    return Promise.resolve(0);
  }

  unref(): this {
    return this;
  }
}

const makeTempDirectory = async (): Promise<string> => {
  const path = await mkdtemp(join(tmpdir(), "lucent-script-files-"));
  tempDirectories.add(path);
  return path;
};

afterEach(async () => {
  await Promise.all(
    [...tempDirectories].map((path) =>
      rm(path, { force: true, recursive: true }),
    ),
  );
  tempDirectories.clear();
});

describe("script file processing", () => {
  it("returns the current source and extracted inputs after a same-size edit", async () => {
    const directory = await makeTempDirectory();
    const path = join(directory, "farm.js");
    const firstSource = [
      'const helper = require("./helper");',
      "module.exports = function* run() { return 1; };",
      "module.exports.inputs = { fields: [] };",
    ].join("\n");
    const secondSource = firstSource.replace("return 1", "return 2");
    expect(secondSource).toHaveLength(firstSource.length);

    await writeFile(path, firstSource);
    const firstStat = await stat(path);
    const first = await processScriptFile(path);

    await writeFile(path, secondSource);
    await utimes(path, firstStat.atime, firstStat.mtime);
    const second = await processScriptFile(path);

    expect(first.status).toBe("found");
    expect(second.status).toBe("found");
    if (first.status === "found" && second.status === "found") {
      expect(first.analysis.file.source).toBe(firstSource);
      expect(second.analysis.file.source).toBe(secondSource);
      expect(second.analysis.file.revision).not.toBe(
        first.analysis.file.revision,
      );
      expect(second.analysis.file.inputs).toEqual({ id: path, fields: [] });
      expect(second.analysis.requirements).toEqual(["./helper"]);
    }
  });

  it("does not cache missing files", async () => {
    const directory = await makeTempDirectory();
    const path = join(directory, "created-later.js");

    await expect(processScriptFile(path)).resolves.toEqual({
      status: "missing",
      path,
    });

    await writeFile(path, "module.exports = function* run() {};");
    const resolution = await processScriptFile(path);
    expect(resolution.status).toBe("found");
  });

  it("returns processing failures for malformed and oversized scripts", async () => {
    const directory = await makeTempDirectory();
    const malformedPath = join(directory, "malformed.js");
    const oversizedPath = join(directory, "oversized.js");
    await writeFile(malformedPath, "module.exports = function* (");
    await writeFile(oversizedPath, "");
    await truncate(oversizedPath, SCRIPT_FILE_MAX_BYTES + 1);

    const malformed = await processScriptFile(malformedPath);
    const oversized = await processScriptFile(oversizedPath);

    expect(malformed).toMatchObject({
      status: "failed",
      path: malformedPath,
      message: expect.stringContaining("parsed"),
    });
    expect(oversized).toMatchObject({
      status: "failed",
      path: oversizedPath,
      message: expect.stringContaining("16 MiB"),
    });
  });
});

describe("ScriptFiles service", () => {
  it("continues queued requests with a fresh worker after an active failure", async () => {
    const workers: FakeWorker[] = [];
    const client = new ScriptFileWorkerClient(() => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker as unknown as Worker;
    });

    const first = client.resolve("/scripts/slow.js");
    const firstFailure = expect(first).rejects.toThrow("worker crashed");
    const second = client.resolve("/scripts/healthy.js");

    workers[0]?.emit("error", new Error("worker crashed"));
    await firstFailure;

    expect(workers).toHaveLength(2);
    const secondRequest = workers[1]?.messages[0] as
      | { readonly id: number }
      | undefined;
    expect(secondRequest).toBeDefined();
    workers[1]?.emit("message", {
      id: secondRequest?.id,
      resolution: {
        status: "missing",
        path: "/scripts/healthy.js",
      },
    });

    await expect(second).resolves.toEqual({
      status: "missing",
      path: "/scripts/healthy.js",
    });
    await client.close();
  });

  it("coalesces concurrent requests for the same normalized path", async () => {
    let calls = 0;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const processFile = async (
      path: string,
    ): Promise<ScriptFileAnalysisResolution> => {
      calls += 1;
      await gate;
      return {
        status: "found",
        analysis: {
          file: {
            inputs: null,
            name: "farm.js",
            path,
            revision: "abc123",
            source: "module.exports = function* run() {};",
          },
          fingerprint: "fingerprint",
          requirements: [],
        },
      };
    };
    const resolveFile = makeScriptFileResolver(processFile);

    const first = resolveFile("./scripts/farm.js");
    const second = resolveFile("scripts/farm.js");
    await Promise.resolve();

    expect(calls).toBe(1);
    release?.();
    const [firstResolution, secondResolution] = await Promise.all([
      first,
      second,
    ]);
    expect(firstResolution).toEqual(secondResolution);
    expect(firstResolution).toMatchObject({
      status: "found",
      analysis: { file: { path: resolvePath("scripts/farm.js") } },
    });
  });
});
