import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("approved remediation canon", () => {
  it("binds the new inventory to the approved exact source without rewriting v4", () => {
    const inventory = JSON.parse(read("docs/AMS_DATA_HUB_REMEDIATION_PRODUCTION_READINESS_MASTER_PLAN_V1.inventory.json")) as {
      source: { path: string; sha256: string; status: string };
      nodes: { type: string }[];
    };
    expect(inventory.source.status).toBe("APPROVED");
    expect(createHash("sha256").update(readFileSync(inventory.source.path)).digest("hex"))
      .toBe(inventory.source.sha256);
    expect(inventory.nodes.filter((node) => node.type === "epic")).toHaveLength(11);
    expect(createHash("sha256").update(readFileSync("docs/AMS Data Hub Master Plan v1.md")).digest("hex"))
      .toBe("2d4a2e86ef8ba30965786d8e3e5675b29a8d949d485caed9060f69f70be53750");
  });

  it("keeps approved current TOTP policy separate from pending runtime removal", () => {
    const constitution = read("docs/00_CONSTITUTION.MD.md");
    expect(constitution).toContain("2FA/TOTP = NOT IMPLEMENTED / NOT REQUIRED");
    expect(constitution).toContain("OQ-09 is **DEFERRED**");
    expect(constitution).toContain("Revisit only post-pilot by an explicit owner decision");
    for (const path of ["docs/01_PRD.md", "docs/03_ARCHITECTURE.md", "docs/SECURITY.md",
      "docs/OPERATIONS.md", "docs/adr/ADR-005-identity-platform-admin-hardening.md",
      "docs/adr/ADR-009-postgresql-security-evidence.md"]) {
      const text = read(path);
      expect(text).not.toMatch(/authority requires verified TOTP|requires TOTP enrollment|Admin requires TOTP|requires a new verified TOTP|setup\/recovery\/TOTP gates/);
      expect(text).toContain("MP-01");
    }
  });

  it("preserves producer/format ownership and explicit reviewed manual apply", () => {
    const text = read("docs/00_CONSTITUTION.MD.md");
    for (const token of ["YRL / Vladis, Domclick XML", "Avito v3 and CIAN v2",
      "format-specific behavior belongs to `SourceAdapter`", "inside parser core is forbidden",
      "input → staging → dry-run → reviewed plan hash → explicit manual apply → audit/revision",
      "There is no automatic scheduler"]) expect(text).toContain(token);
  });

  it("limits pilot-name privacy exceptions to exact approved planning bytes", () => {
    const verifier = read("scripts/verify-public-data.mjs");
    expect(verifier).toContain("const approvedPlanArtifacts = new Map");
    expect(verifier).toContain("if (actualHash !== approvedHash)");
    expect(verifier).toContain("Approved planning artifact hash changed");
    expect(verifier).toContain("d3d0bc7df74ac36e3f91260b806ec6dc94beca50c9ece88d074d8a80169fcd1a");
    expect(verifier).toContain("371c3bbda3b7f8da30cff63a15b3685e1cef067dfb4e844083126509373b8f00");
  });

  it("does not equate contracts and operation requests with runtime readiness", () => {
    const architecture = read("docs/03_ARCHITECTURE.md");
    expect(architecture).toContain("foundation evidence, not production readiness");
    expect(architecture).toContain("SourceExecutionService now provides scoped application orchestration");
    expect(architecture).toContain("Concrete server composition now binds scoped Prisma loading");
    expect(architecture).toContain("Snapshot build/publish");
    expect(architecture).toContain("publication is not performed in the import transaction");
    expect(architecture).toContain("Broken runs leave current");
    expect(architecture).toContain("service unit tests are not production composition proof");
    expect(architecture).toContain("complete runtime proof remains");
    expect(architecture).toContain("not a PRODUCTION READY claim");
    expect(architecture).toContain("Notification retries/dead-letter cannot undo publication");
    expect(read("docs/OPERATIONS.md")).toContain("An Admin request or contract test");
    expect(read("docs/DELIVERY_STATE.yaml")).toContain("readiness: NOT_PRODUCTION_READY");
  });
});
