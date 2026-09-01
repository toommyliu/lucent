import { promises as fs } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { describe, expect, it } from "@effect/vitest";
import { afterEach, vi } from "vitest";

import { makeBufferedDesktopLogWriter } from "./DesktopLogWriter";

const MAX_LOG_BYTES = 32 * 1024 * 1024;
const fixtureDirectories = new Set<string>();

const makeFixture = async (): Promise<string> => {
  const path = await fs.mkdtemp(join(tmpdir(), "lucent-log-writer-"));
  fixtureDirectories.add(path);
  return path;
};

const makeSignal = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
};

const readRecords = async (path: string): Promise<unknown[]> =>
  (await fs.readFile(path, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));

afterEach(async () => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  await Promise.all(
    [...fixtureDirectories].map((path) =>
      fs.rm(path, { recursive: true, force: true }),
    ),
  );
  fixtureDirectories.clear();
});

describe("DesktopLogWriter", () => {
  it("bounds pending records while preserving accepted record order", async () => {
    const root = await makeFixture();
    const logsDir = join(root, "logs");
    const logFilePath = join(logsDir, "lucent.log");
    const writer = makeBufferedDesktopLogWriter(logsDir, logFilePath);

    for (let sequence = 0; sequence < 300; sequence += 1) {
      writer.write({ sequence });
    }
    await writer.close({ sequence: "final" });

    const records = await readRecords(logFilePath);
    expect(records).toHaveLength(258);
    expect(records.slice(0, 256)).toEqual(
      Array.from({ length: 256 }, (_, sequence) => ({ sequence })),
    );
    expect(records[256]).toEqual({ sequence: "final" });
    expect(records[257]).toMatchObject({
      event: "records.dropped",
      data: { count: 44 },
    });
  });

  it("rotates the bounded file history before appending a new batch", async () => {
    const root = await makeFixture();
    const logsDir = join(root, "logs");
    const logFilePath = join(logsDir, "lucent.log");
    await fs.mkdir(logsDir, { recursive: true });
    await fs.writeFile(logFilePath, "");
    await fs.truncate(logFilePath, MAX_LOG_BYTES);
    await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        fs.writeFile(`${logFilePath}.${index + 1}`, `rotation-${index + 1}`),
      ),
    );

    const writer = makeBufferedDesktopLogWriter(logsDir, logFilePath);
    await writer.close({ sequence: "new" });

    expect((await fs.stat(`${logFilePath}.1`)).size).toBe(MAX_LOG_BYTES);
    expect(await fs.readFile(`${logFilePath}.2`, "utf8")).toBe("rotation-1");
    expect(await fs.readFile(`${logFilePath}.3`, "utf8")).toBe("rotation-2");
    expect(await fs.readFile(`${logFilePath}.4`, "utf8")).toBe("rotation-3");
    expect(await readRecords(logFilePath)).toEqual([{ sequence: "new" }]);
  });

  it("continues with later batches after a filesystem failure", async () => {
    vi.useFakeTimers();
    const root = await makeFixture();
    const logsDir = join(root, "logs");
    const logFilePath = join(logsDir, "lucent.log");
    const firstAttempt = makeSignal();
    vi.spyOn(fs, "appendFile").mockImplementationOnce(async () => {
      firstAttempt.resolve();
      throw new Error("simulated append failure");
    });
    const writer = makeBufferedDesktopLogWriter(logsDir, logFilePath);

    writer.write({ sequence: "lost" });
    await vi.advanceTimersByTimeAsync(250);
    await firstAttempt.promise;
    writer.write({ sequence: "kept" });
    await writer.close();

    expect(await readRecords(logFilePath)).toEqual([{ sequence: "kept" }]);
  });
});
