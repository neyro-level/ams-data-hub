import { describe, expect, it } from "vitest";
import { operationalRequestStateLabel } from "../src/modules/operations-control/index.ts";
import { projectOperationalResult } from "../src/modules/operations-control/domain/operational-request-presentation.ts";

describe("request state presentation", () => {
  it.each(["SNAPSHOT_BUILD", "SNAPSHOT_PUBLISH", "SNAPSHOT_ROLLBACK", "ACK_ROTATE", "SUSPICIOUS_APPROVE", "SUSPICIOUS_REJECT"])("does not report acceptance as completion: %s", (action) => {
    expect(operationalRequestStateLabel({ action, status: "REQUESTED" })).toContain("ожидает исполнителя");
    expect(operationalRequestStateLabel({ action, status: "RUNNING" })).toContain("ещё не подтверждён");
    expect(operationalRequestStateLabel({ action, status: "FAILED" })).toContain("не завершена");
    expect(operationalRequestStateLabel({ action, status: "SUCCEEDED" })).not.toContain("ожидает");
  });
  it("does not confuse successful BUILD with publication", () => {
    const build = operationalRequestStateLabel({ action: "SNAPSHOT_BUILD", status: "SUCCEEDED" });
    expect(build).toContain("этот запрос не выполняет публикацию");
    expect(operationalRequestStateLabel({ action: "SNAPSHOT_PUBLISH", status: "SUCCEEDED" })).toBe("Snapshot опубликован");
    expect(operationalRequestStateLabel({ action: "SNAPSHOT_BUILD", status: "SUCCEEDED" })).toBe(build);
    expect(build).not.toContain("ещё не выполнена");
  });
  it("allows only validated action-matched completed metadata without proof hashes", () => {
    const raw = { action: "SNAPSHOT_BUILD", buildInputId: "build-1", publishSequence: 2, inputHash: "a".repeat(64), manifestSha256: "b".repeat(64) };
    expect(projectOperationalResult(raw.action, "SUCCEEDED", raw)).toEqual({ action: raw.action, buildInputId: "build-1", publishSequence: 2 });
    for (const status of ["REQUESTED", "RUNNING", "FAILED"]) expect(projectOperationalResult(raw.action, status, raw)).toBeNull();
    for (const changed of [{ ...raw, token: "private" }, { ...raw, publishSequence: 0 }, { ...raw, inputHash: "invalid" }, null])
      expect(projectOperationalResult(raw.action, "SUCCEEDED", changed)).toBeNull();
    expect(projectOperationalResult("SNAPSHOT_PUBLISH", "SUCCEEDED", raw)).toBeNull();
  });
  it.each([
    [{ action: "SNAPSHOT_PUBLISH", buildInputId: "build-2", deliveryRunId: "run", manifestSha256: "a".repeat(64), publishSequence: 3 }, { action: "SNAPSHOT_PUBLISH", buildInputId: "build-2", publishSequence: 3 }],
    [{ action: "SNAPSHOT_ROLLBACK", sourcePublishSequence: 1, sourceDeliveryRunId: "old", deliveryRunId: "new", manifestSha256: "a".repeat(64), publishSequence: 4 }, { action: "SNAPSHOT_ROLLBACK", sourcePublishSequence: 1, publishSequence: 4 }],
    [{ action: "ACK_ROTATE", phase: "PROMOTE", previousCredentialVersion: 1, credentialVersion: 2 }, { action: "ACK_ROTATE", phase: "PROMOTE", credentialVersion: 2 }],
    [{ action: "SUSPICIOUS_REJECT", sourceRevisionId: "revision" }, { action: "SUSPICIOUS_REJECT", sourceRevisionId: "revision" }],
    [{ action: "SUSPICIOUS_APPROVE", sourceRevisionId: "revision", sequence: 2, snapshotTriggered: true }, { action: "SUSPICIOUS_APPROVE", sourceRevisionId: "revision" }],
  ])("strips server-only fields from each remaining result", (raw, expected) => {
    expect(projectOperationalResult(raw.action, "SUCCEEDED", raw)).toEqual(expected);
  });
});
