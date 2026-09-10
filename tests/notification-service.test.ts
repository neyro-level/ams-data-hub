import { describe, expect, it } from "vitest";
import { createNotificationService, type NotificationRepository } from "../src/modules/notifications/application/notification-service.ts";
import type { PrincipalContext } from "../src/platform/authorization/principal.ts";

function repository(): NotificationRepository {
  return {
    async list(audience, query) { return { items: [], total: 0, page: query.page, pageSize: query.pageSize, unreadCount: audience.includeAdminOnly ? 2 : 1 }; },
    async recent(audience, limit) { return { items: [], total: 0, page: 1, pageSize: limit, unreadCount: audience.includeAdminOnly ? 2 : 1 }; },
    async canRead() { return true; }, async setRead() {}, async markAllRead() { return 0; },
    async filterOptions() { return { organizations: [], projects: [], sites: [] }; },
  };
}

describe("notification audience", () => {
  const service = createNotificationService({ createRepository: repository });
  const admin: PrincipalContext = { kind: "platform-admin", userId: "admin", correlationId: "corr" };
  const analyst: PrincipalContext = { kind: "platform-analyst", userId: "analyst", correlationId: "corr" };
  const viewer: PrincipalContext = { kind: "tenant-user", userId: "viewer", organizationId: "org", membershipId: "member", role: "VIEWER", correlationId: "corr" };

  it("shows admin-only events only to Platform Admin", async () => {
    await expect(service.getNotificationSummary(admin)).resolves.toMatchObject({ unreadCount: 2 });
    await expect(service.getNotificationSummary(analyst)).resolves.toMatchObject({ unreadCount: 1 });
  });

  it("denies CLIENT_VIEWER", async () => {
    await expect(service.getNotificationSummary(viewer)).rejects.toThrow("NOTIFICATION_ACCESS_DENIED");
  });
});
