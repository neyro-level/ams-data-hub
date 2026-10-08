import { describe, expect, it } from "vitest";
import { operationalRequestStateLabel } from "../src/modules/operations-control/index.ts";

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
});
