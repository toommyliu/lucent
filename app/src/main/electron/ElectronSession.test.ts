import { describe, expect, it } from "@effect/vitest";

import {
  makeGamePartitionRegistry,
  managedGamePartition,
} from "./ElectronGamePartitions";

describe("Electron game partition leases", () => {
  it("reuses a managed profile only after its previous lease closes", () => {
    const randomIds = ["a".repeat(24), "b".repeat(24)];
    const partitions = makeGamePartitionRegistry({
      makeRandomId: () => randomIds.shift()!,
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
      `persist:lucent-game-standalone-42-${"a".repeat(24)}`,
    );

    partitions.release(managed);
    expect(partitions.acquire({ kind: "managed-account", key: "Alice" })).toBe(
      managed,
    );
    expect(partitions.acquire({ kind: "standalone" })).toBe(
      `persist:lucent-game-standalone-42-${"b".repeat(24)}`,
    );
  });
});
