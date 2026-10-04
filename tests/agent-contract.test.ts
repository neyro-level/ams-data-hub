import { createUlid } from "@ams-data-hub/data-contracts";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AGENT_FEED_OWNED_FIELDS,
  AGENT_MANUAL_OWNED_FIELDS,
  bulkAgentVisibilityInputSchema,
  confirmAgentConsentBatchInputSchema,
  isAgentPubliclyPublishable,
  isSuspiciousAgentBulkChange,
  mergeAgentsInputSchema,
  saveManualAgentInputSchema,
} from "../src/modules/project-state/index.ts";

describe("agent contract", () => {
  it("keeps feed-owned and manual-owned fields disjoint", () => {
    expect(AGENT_FEED_OWNED_FIELDS).toEqual(["fullName", "workPhone", "workEmail", "feedPhotoMediaId"]);
    expect(AGENT_MANUAL_OWNED_FIELDS).toContain("showOnSite");
    expect(AGENT_FEED_OWNED_FIELDS.filter((field) => AGENT_MANUAL_OWNED_FIELDS.includes(field as never))).toEqual([]);
  });

  it("marks only changes above the 30 percent threshold as suspicious", () => {
    expect(isSuspiciousAgentBulkChange(10, 3)).toBe(false);
    expect(isSuspiciousAgentBulkChange(10, 4)).toBe(true);
    expect(isSuspiciousAgentBulkChange(0, 1)).toBe(false);
  });

  it("validates manual records and explicit merge/batch operations", () => {
    const base = { organizationId: "org-1", projectId: "project-1" };
    expect(saveManualAgentInputSchema.parse({
      ...base, version: 0, origin: "MANUAL", slug: "anna-agent", role: "AGENT", fullName: "Анна Агент",
      position: "", bio: "", specializations: [], photoMediaId: null, workPhone: "", workEmail: "",
      messengers: [], showOnSite: false, sortOrder: 0, status: "ACTIVE", listingPresenceStatus: "UNKNOWN",
    }).slug).toBe("anna-agent");
    const sourceAgentUid = createUlid();
    const targetAgentUid = createUlid();
    expect(mergeAgentsInputSchema.parse({ ...base, sourceAgentUid, sourceVersion: 1, targetAgentUid, targetVersion: 1 })).toMatchObject({ sourceAgentUid, targetAgentUid });
    expect(() => mergeAgentsInputSchema.parse({ ...base, sourceAgentUid, sourceVersion: 1, targetAgentUid: sourceAgentUid, targetVersion: 1 })).toThrow();
    expect(() => bulkAgentVisibilityInputSchema.parse({ ...base, agentUids: [sourceAgentUid, sourceAgentUid], showOnSite: true })).toThrow();
    expect(confirmAgentConsentBatchInputSchema.parse({
      ...base,
      agentUids: [sourceAgentUid],
      confirmedBy: "Оператор проекта",
      confirmedAt: "2026-10-05T10:00:00+03:00",
      basis: "Письменное подтверждение",
      referenceUrl: "https://example.test/evidence/1",
      note: "Проверено оператором",
      confirmSuspicious: false,
    }).agentUids).toEqual([sourceAgentUid]);
  });

  it("requires every public-agent gate", () => {
    const base = { status: "ACTIVE" as const, showOnSite: true, consentConfirmedAt: new Date() };
    expect(isAgentPubliclyPublishable(base)).toBe(true);
    expect(isAgentPubliclyPublishable({ ...base, status: "HIDDEN" })).toBe(false);
    expect(isAgentPubliclyPublishable({ ...base, showOnSite: false })).toBe(false);
    expect(isAgentPubliclyPublishable({ ...base, consentConfirmedAt: null })).toBe(false);
  });

  it("wires the project admin agent form to safe media selection and the server action", () => {
    const source = readFileSync("src/app/admin/_components/ProjectAdminForms.tsx", "utf8");
    expect(source).toContain("saveManualAgentAction");
    expect(source).toContain("confirmAgentConsentBatchAction");
    expect(source).toContain("photoMediaId");
    expect(source).toContain("ФИО и рабочие контакты принадлежат фиду");
    expect(source).not.toContain("dangerouslySetInnerHTML");
  });
});
