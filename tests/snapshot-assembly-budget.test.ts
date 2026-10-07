import { describe, expect, it } from "vitest";
import { SnapshotAssemblyBudget } from "../src/modules/snapshot-delivery/application/snapshot-assembly-budget.ts";
import { SNAPSHOT_DATASET_KINDS } from "../src/modules/snapshot-delivery/index.ts";

describe("aggregate snapshot array budget", () => {
  it("includes all thirteen empty arrays and exact page-spanning separators", () => {
    const emptyBytes = SNAPSHOT_DATASET_KINDS.length * 2;
    const budget = new SnapshotAssemblyBudget(emptyBytes + 3);
    budget.add("inventory", [{ key: "one", value: 1 }]);
    expect(() => budget.add("inventory", [{ key: "two", value: 2 }])).not.toThrow();
    expect(() => budget.add("inventory", [{ key: "three", value: 3 }])).toThrow("SNAPSHOT_ASSEMBLY_LIMIT_EXCEEDED");
  });
  it("does not add a separator between distinct datasets but rejects empty-array overflow", () => {
    const emptyBytes = SNAPSHOT_DATASET_KINDS.length * 2;
    const budget = new SnapshotAssemblyBudget(emptyBytes + 2);
    budget.add("inventory", [{ key: "one", value: 1 }]);
    budget.add("agents", [{ key: "two", value: 2 }]);
    expect(() => new SnapshotAssemblyBudget(emptyBytes - 1)).toThrow("SNAPSHOT_ASSEMBLY_LIMIT_EXCEEDED");
  });
});
