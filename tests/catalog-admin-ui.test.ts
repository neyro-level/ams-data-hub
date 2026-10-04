import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseCatalogAdminQuery } from "../src/modules/shared-catalog/contracts.ts";
import { getPlatformAdminResourceDefinition, isPlatformAdminResourceKey } from "../src/modules/platform-admin/index.ts";

describe("catalog admin UI contract", () => {
  it("registers the catalog as a real platform-admin resource", () => {
    expect(isPlatformAdminResourceKey("catalog")).toBe(true);
    expect(getPlatformAdminResourceDefinition("catalog")).toMatchObject({
      label: "Каталог",
      href: "/admin/catalog/",
    });
  });

  it("parses business filters without accepting arbitrary identifiers", () => {
    expect(parseCatalogAdminQuery({ q: "  Южный  ", lifecycle: "ACTIVE" })).toMatchObject({
      q: "Южный",
      lifecycle: "ACTIVE",
      regionUid: "",
      cityUid: "",
      developerUid: "",
    });
    expect(() => parseCatalogAdminQuery({ lifecycle: "DELETED" })).toThrow();
    expect(() => parseCatalogAdminQuery({ regionUid: "not-a-ulid" })).toThrow();
    expect(() => parseCatalogAdminQuery({ cityUid: "not-a-ulid" })).toThrow();
  });

  it("keeps list, mobile, forms, batch entry and visible feedback in the workspace", () => {
    const workspace = readFileSync("src/app/admin/_components/CatalogAdminWorkspace.tsx", "utf8");
    const forms = readFileSync("src/app/admin/_components/CatalogAdminForms.tsx", "utf8");
    const table = readFileSync("src/app/admin/_components/CatalogEntityTable.tsx", "utf8");
    for (const label of ["Застройщики", "Жилые комплексы", "Корпуса и литеры", "Все регионы", "Все города", "Все статусы"]) {
      expect(workspace).toContain(label);
    }
    expect(forms).toContain("Быстро добавить корпуса");
    expect(forms).toContain("FeedbackMessage");
    expect(forms).toContain("Сохранить");
    expect(table).toContain("mobileRenderer");
    expect(table).toContain("StatusBadge");
  });
});
