import { readFile } from "node:fs/promises";
import nextConfig from "../next.config.ts";
import { describe, expect, it } from "vitest";

describe("runtime safety headers", () => {
  it("marks every private route family as non-cacheable", async () => {
    const rules = await nextConfig.headers?.();
    const protectedSources = rules?.filter((rule) => rule.headers.some((header) => header.value.includes("no-store"))).map((rule) => rule.source) ?? [];
    expect(protectedSources).toEqual(expect.arrayContaining(["/api/:path*", "/admin/:path*", "/dashboard/:path*", "/notifications/:path*"]));
  });

  it("keeps the public error surface free of server error details", async () => {
    const source = await readFile("src/app/error.tsx", "utf8");
    expect(source).toContain("APPLICATION_ERROR");
    expect(source).not.toContain("error.message");
  });
});
