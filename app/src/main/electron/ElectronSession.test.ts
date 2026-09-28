import { describe, expect, it } from "@effect/vitest";

import {
  defaultGamePartition,
  makeGamePartitionRegistry,
  managedGamePartition,
} from "./ElectronGamePartitions";

describe("Electron game partition leases", () => {
  it("isolates concurrent clients of the same managed account", () => {
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

    expect(managed).toBe(managedGamePartition("ALICE"));
    expect(duplicate).toBe(
      `persist:lucent-game-temporary-42-${"a".repeat(24)}`,
    );

    partitions.release(managed);
    expect(
      partitions.acquire({ kind: "managed-account", key: "Alice" }),
    ).toEqual(managed);
  });

  it("persists one default profile and isolates concurrent clients", () => {
    const partitions = makeGamePartitionRegistry({
      makeRandomId: () => "b".repeat(24),
      processId: 42,
    });
    const primary = partitions.acquire({ kind: "default" });
    const concurrent = partitions.acquire({ kind: "default" });

    expect(primary).toBe(defaultGamePartition);
    expect(concurrent).toBe(
      `persist:lucent-game-temporary-42-${"b".repeat(24)}`,
    );

    partitions.release(primary);
    expect(partitions.acquire({ kind: "default" })).toEqual(primary);
  });
});
