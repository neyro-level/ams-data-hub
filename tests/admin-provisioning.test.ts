import { describe, expect, it } from "vitest";
import {
  fixedPasswordSchema,
  provisionClientInputSchema,
} from "../src/modules/identity-access/domain/admin-identity.ts";

describe("Platform Admin client provisioning contract", () => {
  const site = { name: "Основной сайт", slug: "main", url: "https://example.test", timezone: "Europe/Moscow", regionName: "Россия", regionCountryCode: "RU", yandexRegionKey: 225, googleRegionKey: 225, queries: Array.from({ length: 20 }, (_, index) => `запрос ${index + 1}`) };
  it("accepts exactly eight printable characters", () => {
    expect(fixedPasswordSchema.parse("Ab12!xyz")).toBe("Ab12!xyz");
    expect(() => fixedPasswordSchema.parse("Ab12!xy")).toThrow();
    expect(() => fixedPasswordSchema.parse("Ab12!xyzz")).toThrow();
    expect(() => fixedPasswordSchema.parse("Ab12 xyz")).toThrow();
  });

  it("defaults tenant access to VIEWER", () => {
    const result = provisionClientInputSchema.parse({
      organizationName: "Клиент",
      organizationSlug: "client",
      projectName: "Проект",
      projectSlug: "client-project",
      thresholdProfileId: "threshold",
      clusterProfileId: "cluster",
      userName: "Пользователь",
      username: "client_user",
      password: "Ab12!xyz",
      sites: [site],
    });
    expect(result.tenantRole).toBe("VIEWER");
    expect(result.sites).toHaveLength(1);
  });

  it("requires 1-50 sites and 20-100 unique queries per site", () => {
    const base = { organizationName: "Клиент", organizationSlug: "client", projectName: "Проект", projectSlug: "client-project", thresholdProfileId: "threshold", clusterProfileId: "cluster", userName: "Пользователь", username: "client_user", password: "Ab12!xyz" };
    expect(() => provisionClientInputSchema.parse({ ...base, sites: [] })).toThrow();
    expect(() => provisionClientInputSchema.parse({ ...base, sites: [{ ...site, queries: site.queries.slice(0, 19) }] })).toThrow();
    expect(() => provisionClientInputSchema.parse({ ...base, sites: [{ ...site, queries: Array.from({ length: 101 }, (_, index) => `запрос ${index}`) }] })).toThrow();
    expect(() => provisionClientInputSchema.parse({ ...base, sites: [{ ...site, queries: Array(20).fill("один запрос") }] })).toThrow();
  });
});
