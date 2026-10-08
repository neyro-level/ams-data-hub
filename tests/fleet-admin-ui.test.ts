import { describe, expect, it } from "vitest";
import { getPlatformAdminResourceDefinition, isPlatformAdminResourceKey } from "../src/modules/platform-admin/index.ts";

describe("fleet admin resource", () => {
  it("registers the read-only fleet dashboard as a platform-admin route", () => {
    expect(isPlatformAdminResourceKey("fleet")).toBe(true);
    expect(getPlatformAdminResourceDefinition("fleet")).toMatchObject({ href: "/admin/fleet/" });
  });

  it("exposes guarded actions, safety state and audit without claiming executor completion", () => {
    const forms = readFileSync("src/app/admin/_components/OperationsControlForms.tsx", "utf8");
    const dashboard = readFileSync("src/app/admin/_components/FleetDashboard.tsx", "utf8");
    for (const label of ["Запросить запуск источника", "Запросить подтверждение SUSPICIOUS", "Запросить отклонение SUSPICIOUS", "Запросить Build Snapshot", "Запросить Publish Snapshot", "Запросить rollback новым sequence", "Запросить ротацию ACK-токена", "Freeze jobs", "Unfreeze jobs"]) {
      expect(forms).toContain(label);
    }
    expect(forms).toContain("Принятие запроса не означает завершения");
    expect(forms).toContain("result.data.requestId");
    expect(forms).toContain("disabled={!ready || form.formState.isSubmitting}");
    expect(dashboard).toContain("История операций");
    expect(dashboard).toContain("operationalRequestStateLabel(request)");
    expect(forms).toContain("reconcile");
    expect(forms).toContain('form.register("ackRotationPhase")');
    expect(forms).toContain('form.register("ackCredentialVersion", { valueAsNumber: true })');
    expect(forms).toContain("shouldUnregister: true");
    expect(forms).not.toContain('form.register("nextToken")');
    expect(dashboard).toContain("Последние события аудита");
    expect(dashboard).not.toContain("afterMarker");
    expect(dashboard).not.toContain("actorId");
  });
});
import { readFileSync } from "node:fs";
