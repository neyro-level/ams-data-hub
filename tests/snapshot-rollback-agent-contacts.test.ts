import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prepareSnapshotRollbackAgentContactPins } from "../src/modules/project-state/index.ts";

const uid = "01M41T6Q04BADHXSERJHZFXKCH";
const row = { uid, workPhone: "+70000000000", workEmail: "synthetic@example.test",
  messengers: ["https://example.test/агент", "https://example.test/second"] };
const hash = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
describe("value-free rollback Agent contact pins", () => {
  it("frames UTF-8 contacts deterministically without carrying values or mutating the public row", () => {
    const before = structuredClone(row); const [pin] = prepareSnapshotRollbackAgentContactPins([row]);
    expect(pin).toEqual({ uid, workPhoneHash: hash(`string:${row.workPhone}`), workEmailHash: hash(`string:${row.workEmail}`),
      messengersHash: hash(`array:${row.messengers.map((value) => `${Buffer.byteLength(value)}:${value}`).join("")}`) });
    expect(JSON.stringify(pin)).not.toMatch(/example|700000|агент/u); expect(row).toEqual(before);
    expect(prepareSnapshotRollbackAgentContactPins([{ ...row, fullName: "Synthetic renamed" }])).toEqual([pin]);
  });
  it("keeps null, empty, ordering and string frame boundaries distinct", () => {
    const pins = [null, ""].map((workPhone) => prepareSnapshotRollbackAgentContactPins([{ ...row, workPhone }])[0]!);
    expect(pins[0].workPhoneHash).not.toBe(pins[1].workPhoneHash);
    const original = prepareSnapshotRollbackAgentContactPins([row])[0]!;
    const reversed = prepareSnapshotRollbackAgentContactPins([{ ...row, messengers: [...row.messengers].reverse() }])[0]!;
    expect(original.messengersHash).not.toBe(reversed.messengersHash);
  });
  it.each(["duplicate", "invalid-email", "invalid-url", "too-many"])("rejects %s with a finite value-free error", (mode) => {
    const rows = mode === "duplicate" ? [row, row] : mode === "too-many" ? Array.from({ length: 50_001 }, () => row)
      : [{ ...row, ...(mode === "invalid-email" ? { workEmail: "SYNTHETIC_PRIVATE_INVALID" } : { messengers: ["SYNTHETIC_PRIVATE_INVALID"] }) }];
    expect(() => prepareSnapshotRollbackAgentContactPins(rows)).toThrow("SNAPSHOT_ROLLBACK_CONTACT_PINS_INVALID");
  });
});
