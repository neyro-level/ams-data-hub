import { describe, expect, it } from "vitest";
import {
  getApprovedRoutes,
  getGoalProfileForClient,
  getRegistryBundle,
} from "./helpers/example-registry.ts";

describe("registry bundle", () => {
  it("loads clients, clusters and thresholds", () => {
    const bundle = getRegistryBundle();

    expect(bundle.clients).toHaveLength(2);
    expect(bundle.clusters.map((cluster) => cluster.profileSlug)).toContain("real-estate");
    expect(bundle.thresholds.queryOpportunity.minimumShows).toBe(30);
  });

  it("keeps connected and planned sites in approved routes", () => {
    const routes = getApprovedRoutes();

    expect(routes).toContain("/analyst/");

    expect(routes).toContain("/c/alpha/east/");
    expect(routes).toContain("/c/alpha/south/");
    expect(routes).toContain("/c/beta/west/");
  });

  it("wires all three Alpha cities to exact Webmaster and Metrica sources", () => {
    const alpha = getRegistryBundle().clients.find((client) => client.clientSlug === "alpha");

    expect(
      alpha?.sites.map((site) => ({
        slug: site.siteSlug,
        enabled: site.enabled,
        webmaster: site.webmaster.enabled,
        metrica: site.metrica.enabled,
        counterId: site.metrica.counterId,
      })),
    ).toEqual([
      {
        slug: "north",
        enabled: true,
        webmaster: true,
        metrica: true,
        counterId: "700001",
      },
      {
        slug: "east",
        enabled: true,
        webmaster: true,
        metrica: true,
        counterId: "700002",
      },
      {
        slug: "south",
        enabled: true,
        webmaster: true,
        metrica: true,
        counterId: "700003",
      },
    ]);
  });

  it("keeps a separate conversion allowlist for every Alpha site", () => {
    const profile = getGoalProfileForClient("alpha");
    const siteSlugs = new Set(profile?.goals.flatMap((goal) => goal.siteSlugs) ?? []);

    expect(siteSlugs).toEqual(new Set(["north", "east", "south"]));
    expect(profile?.goals.filter((goal) => goal.siteSlugs.includes("east"))).toHaveLength(4);
    expect(profile?.goals.filter((goal) => goal.siteSlugs.includes("south"))).toHaveLength(4);
  });
});
