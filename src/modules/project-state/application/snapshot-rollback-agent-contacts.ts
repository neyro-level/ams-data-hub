import { createHash } from "node:crypto";
import { ulidSchema } from "@ams-data-hub/data-contracts";
import { z } from "zod";

const hash = z.string().regex(/^[a-f0-9]{64}$/u);
export const snapshotRollbackAgentContactPinsSchema = z.array(z.object({ uid: ulidSchema,
  workPhoneHash: hash, workEmailHash: hash, messengersHash: hash }).strict()).max(50_000)
  .refine((rows) => new Set(rows.map((row) => row.uid)).size === rows.length);
export type SnapshotRollbackAgentContactPins = z.infer<typeof snapshotRollbackAgentContactPinsSchema>;
const contact = z.object({ uid: ulidSchema, workPhone: z.string().max(40).nullable(),
  workEmail: z.email().nullable(), messengers: z.array(z.url({ protocol: /^https?$/u })).max(10) });
const digest = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

/** Authenticated captured public Agent rows only; no PII in the resulting pins.
 * UTF-8 length framing matches SQL, including Unicode and empty/null distinctions. */
export function prepareSnapshotRollbackAgentContactPins(rows: readonly unknown[]): SnapshotRollbackAgentContactPins {
  if (rows.length > 50_000) throw new Error("SNAPSHOT_ROLLBACK_CONTACT_PINS_INVALID");
  const pins = rows.map((raw) => {
    const parsed = contact.safeParse(raw);
    if (!parsed.success) throw new Error("SNAPSHOT_ROLLBACK_CONTACT_PINS_INVALID");
    const row = parsed.data;
    return { uid: row.uid, workPhoneHash: digest(row.workPhone === null ? "null:" : `string:${row.workPhone}`),
      workEmailHash: digest(row.workEmail === null ? "null:" : `string:${row.workEmail}`),
      messengersHash: digest(`array:${row.messengers.map((value) => `${new TextEncoder().encode(value).length}:${value}`).join("")}`) };
  });
  const parsed = snapshotRollbackAgentContactPinsSchema.safeParse(pins);
  if (!parsed.success) throw new Error("SNAPSHOT_ROLLBACK_CONTACT_PINS_INVALID");
  return parsed.data;
}
