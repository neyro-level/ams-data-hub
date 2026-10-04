import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("project admin workspace tabs", () => {
  it("shows every required project section and preserves later-epic boundaries", () => {
    const source = readFileSync("src/app/admin/_components/ProjectAdminForms.tsx", "utf8");
    for (const label of ["Контакты", "Агенты", "Редактура", "URL и редиректы", "Подписка на каталог", "Источники", "Snapshot"]) {
      expect(source).toContain(`>${label}</TabsTrigger>`);
    }
    expect(source).toContain("Источники появятся после выполнения DH-06");
    expect(source).toContain("Snapshot появится после выполнения DH-05");
    expect(source).toContain("не запускает импорт");
    expect(source).toContain("не собирает, не подписывает и не доставляет снимки данных");
  });

  it("reuses the accessible project-owned Tabs primitive", () => {
    const source = readFileSync("src/app/admin/_components/ProjectAdminForms.tsx", "utf8");
    expect(source).toContain('from "../../../components/ui/tabs.tsx"');
    expect(source).toContain("<TabsList aria-label=");
    expect(source).toContain('<Tabs defaultValue="contacts">');
  });
});
