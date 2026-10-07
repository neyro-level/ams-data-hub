import { ulidSchema } from "@ams-data-hub/data-contracts";
import { z } from "zod";
import type { SnapshotBuildInputReceipt } from "./snapshot-build-input.ts";
import type { SnapshotInventoryCapturedInput } from "./snapshot-inventory-input.ts";

const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u);
const binding = z.object({ entityType: z.literal("agent-binding"), inventoryUid: ulidSchema, sourceId: id,
  sourceRevisionId: id, recordHash: z.string().regex(/^[a-f0-9]{64}$/u), agentUid: ulidSchema }).strict();

/** Captured facts only: no phone/name matching or live consent enrichment. */
export function prepareSnapshotAgentBindings(input: SnapshotBuildInputReceipt,
  inventory: readonly SnapshotInventoryCapturedInput[], eligibleAgents: ReadonlySet<string>) {
  const pins = new Map(inventory.map((row) => [row.pin.uid, row.pin]));
  const seen = new Set<string>(); const output = new Map<string, string>();
  for (const part of input.parts) if (part.kind === "listing-links") for (const raw of part.payload) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw) || raw.entityType !== "agent-binding") continue;
    const parsed = binding.safeParse(raw);
    if (!parsed.success) throw new Error("SNAPSHOT_AGENT_BINDING_INVALID");
    const row = parsed.data; const pin = pins.get(row.inventoryUid);
    if (!pin || seen.has(row.inventoryUid) || pin.sourceId !== row.sourceId
      || pin.factRevisionId !== row.sourceRevisionId || pin.normalizedHash !== row.recordHash) {
      throw new Error("SNAPSHOT_AGENT_BINDING_INVALID");
    }
    seen.add(row.inventoryUid);
    if (eligibleAgents.has(row.agentUid)) output.set(row.inventoryUid, row.agentUid);
  }
  return output;
}
