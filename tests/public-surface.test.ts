import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const removedPaths = [
  "src/app/soglasie/page.tsx",
  "src/app/cookies/page.tsx",
  "src/app/terms/page.tsx",
  "src/app/offline/page.tsx",
  "src/app/manifest.ts",
  "src/app/sitemap.ts",
  "public/sw.js",
  "src/components/pwa/ServiceWorkerRegistration.tsx",
  "src/components/marketing/LeadRequestDialog.tsx",
  "src/shared/config/public-leads-environment.ts",
  "src/shared/leads/send-lead.ts",
] as const;

describe("minimal public surface", () => {
  it("keeps only the approved public page sources", () => {
    expect(existsSync("src/app/page.tsx")).toBe(true);
    expect(existsSync("src/app/politika/page.tsx")).toBe(true);
    expect(existsSync("src/app/not-found.tsx")).toBe(true);
    expect(existsSync("src/app/error.tsx")).toBe(true);
    expect(removedPaths.filter((file) => existsSync(file))).toEqual([]);
  });

  it("disallows indexing at both metadata and robots boundaries", () => {
    const layout = readFileSync("src/app/layout.tsx", "utf8");
    const robots = readFileSync("src/app/robots.ts", "utf8");
    expect(layout).toContain("index: false");
    expect(layout).toContain("follow: false");
    expect(robots).toContain('disallow: "/"');
    expect(robots).not.toContain("sitemap");
  });

  it("publishes the exact operator footer and legal-review marker", () => {
    const footer = readFileSync("src/components/marketing/SiteFooter.tsx", "utf8");
    const legalConfig = readFileSync("src/shared/legal/legal-config.ts", "utf8");
    const policy = readFileSync("src/components/marketing/legal/legal-html.ts", "utf8");
    for (const value of ["© AMS", "ИП Скрицкая Юлия Викторовна", "Политика обработки персональных данных"]) {
      expect(footer).toContain(value);
    }
    for (const value of ["231295699557", "323237500365055", "integrator-p@yandex.ru"]) {
      expect(legalConfig).toContain(value);
    }
    expect(policy).toContain("Требует юридической проверки владельцем");
  });
});
