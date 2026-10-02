import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import manifest from "../src/app/manifest.ts";

describe("PWA baseline", () => {
  it("is installable with neutral app name", () => {
    expect(manifest()).toMatchObject({
      name: "AMS Data Hub",
      short_name: "AMS Data Hub",
      display: "standalone",
    });
  });

  it("excludes private routes from service worker cache", async () => {
    const source = await readFile("public/sw.js", "utf8");
    for (const privatePath of ["/api/", "/admin/", "/dashboard/", "/notifications/"]) {
      expect(source).toContain(privatePath);
    }
    expect(source).toContain("isPrivateRequest(url)");
    expect(source).toContain("CACHE_PREFIX");
    expect(source).toContain("response.ok");
  });
});
