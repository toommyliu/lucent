import { describe, expect, it } from "@effect/vitest";

import {
  defaultGamePartition,
  makeGamePartitionRegistry,
  managedGamePartition,
} from "./ElectronGamePartitions";

describe("Electron game partition leases", () => {
  it("clones a managed profile for a concurrent lease", () => {
    const partitions = makeGamePartitionRegistry({
      makeRandomId: () => "a".repeat(24),
      processId: 42,
    });
    const managed = partitions.acquire({
      kind: "managed-account",
      key: "Alice",
    });
    const duplicate = partitions.acquire({
      kind: "managed-account",
      key: "alice",
    });

    expect(managed).toEqual({
      kind: "persistent",
      partition: managedGamePartition("ALICE"),
    });
    expect(duplicate).toEqual({
      kind: "temporary",
      partition: `persist:lucent-game-temporary-42-${"a".repeat(24)}`,
      sourcePartition: managed.partition,
    });

    partitions.release(managed.partition);
    expect(
      partitions.acquire({ kind: "managed-account", key: "Alice" }),
    ).toEqual(managed);
  });

  it("persists one default profile and clones concurrent leases", () => {
    const partitions = makeGamePartitionRegistry({
      makeRandomId: () => "b".repeat(24),
      processId: 42,
    });
    const primary = partitions.acquire({ kind: "default" });
    const concurrent = partitions.acquire({ kind: "default" });

    expect(primary).toEqual({
      kind: "persistent",
      partition: defaultGamePartition,
    });
    expect(concurrent).toEqual({
      kind: "temporary",
      partition: `persist:lucent-game-temporary-42-${"b".repeat(24)}`,
      sourcePartition: defaultGamePartition,
    });

    partitions.release(primary.partition);
    expect(partitions.acquire({ kind: "default" })).toEqual(primary);
  });
});
