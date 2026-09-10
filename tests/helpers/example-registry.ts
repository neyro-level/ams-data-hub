import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  clientRegistrySchema,
  clusterProfileSchema,
  goalProfileSchema,
  isPlaceholderSiteUrl,
  thresholdsSchema,
  type ClientRegistry,
  type ClusterProfile,
  type GoalProfile,
  type SiteRegistry,
  type ThresholdsConfig,
} from "../../src/shared/schemas/registry.ts";

const configRoot = path.join(process.cwd(), "config", "examples");

function readJsonDirectory(relativePath: string) {
  const directory = path.join(configRoot, relativePath);
  return readdirSync(directory)
    .filter((entry) => entry.endsWith(".json"))
    .sort()
    .map((entry) => JSON.parse(readFileSync(path.join(directory, entry), "utf8")) as unknown);
}

function readJsonFile(relativePath: string) {
  return JSON.parse(
    readFileSync(path.join(configRoot, relativePath), "utf8"),
  ) as unknown;
}

export type RegistryBundle = {
  clients: ClientRegistry[];
  clusters: ClusterProfile[];
  goals: GoalProfile[];
  thresholds: ThresholdsConfig;
};

const parsedBundle = createRegistryBundle();

function createRegistryBundle(): RegistryBundle {
  const clients = readJsonDirectory("clients").map((item) => clientRegistrySchema.parse(item));
  const clusters = readJsonDirectory("clusters").map((item) => clusterProfileSchema.parse(item));
  const goals = readJsonDirectory("goals").map((item) => goalProfileSchema.parse(item));
  const thresholds = thresholdsSchema.parse(readJsonFile("thresholds.json"));

  validateBundle({ clients, clusters, goals, thresholds });

  return { clients, clusters, goals, thresholds };
}

function validateBundle(bundle: RegistryBundle) {
  const clientSlugs = new Set<string>();
  const clusterSlugs = new Set(bundle.clusters.map((cluster) => cluster.profileSlug));
  const goalClientSlugs = new Set(bundle.goals.map((profile) => profile.clientSlug));
  const routePaths = new Set(["/analyst/"]);

  const siteUrls = new Set<string>();
  for (const client of bundle.clients) {
    if (clientSlugs.has(client.clientSlug)) {
      throw new Error(`Duplicate client slug: ${client.clientSlug}`);
    }

    clientSlugs.add(client.clientSlug);

    if (!clusterSlugs.has(client.clusterProfile)) {
      throw new Error(`Unknown cluster profile: ${client.clusterProfile}`);
    }

    if (!goalClientSlugs.has(client.clientSlug)) {
      throw new Error(`Missing goal profile file for client: ${client.clientSlug}`);
    }

    const clientRoute = `/c/${client.clientSlug}/`;
    assertUniqueRoute(routePaths, clientRoute);

    const siteSlugs = new Set<string>();

    for (const site of client.sites) {
      if (siteSlugs.has(site.siteSlug)) {
        throw new Error(`Duplicate site slug inside client ${client.clientSlug}: ${site.siteSlug}`);
      }

      siteSlugs.add(site.siteSlug);

      if (site.enabled && isPlaceholderSiteUrl(site.siteUrl)) {
        throw new Error(`Enabled site has placeholder URL: ${client.clientSlug}/${site.siteSlug}`);
      }

      const parsedSiteUrl = new URL(site.siteUrl);
      const normalizedSitePath =
        parsedSiteUrl.pathname === "/" ? "" : parsedSiteUrl.pathname.replace(/\/$/, "");
      const normalizedSiteUrl =
        `${parsedSiteUrl.protocol.toLowerCase()}//${parsedSiteUrl.hostname.toLowerCase()}${normalizedSitePath}`;
      if (siteUrls.has(normalizedSiteUrl)) {
        throw new Error(`Duplicate site URL: ${site.siteUrl}`);
      }
      siteUrls.add(normalizedSiteUrl);

      const siteRoute = `/c/${client.clientSlug}/${site.siteSlug}/`;
      assertUniqueRoute(routePaths, siteRoute);
    }
  }
}

function assertUniqueRoute(routes: Set<string>, route: string) {
  if (routes.has(route)) {
    throw new Error(`Route collision: ${route}`);
  }

  routes.add(route);
}

export function getRegistryBundle() {
  return parsedBundle;
}

export function getClients() {
  return parsedBundle.clients;
}

export function getClientBySlug(clientSlug: string) {
  return parsedBundle.clients.find((client) => client.clientSlug === clientSlug) ?? null;
}

export function getSiteBySlugs(clientSlug: string, siteSlug: string) {
  const client = getClientBySlug(clientSlug);
  if (!client) {
    return null;
  }

  return client.sites.find((site) => site.siteSlug === siteSlug) ?? null;
}


export function getApprovedRoutes() {
  const routes = ["/", "/demo/", "/analyst/"];
  for (const client of parsedBundle.clients) {
    routes.push(`/c/${client.clientSlug}/`);
    for (const site of client.sites) {
      routes.push(`/c/${client.clientSlug}/${site.siteSlug}/`);
    }
  }
  return routes;
}

export function getGoalProfileForClient(clientSlug: string) {
  return parsedBundle.goals.find((goalProfile) => goalProfile.clientSlug === clientSlug) ?? null;
}

export function hasConnectedSite(client: ClientRegistry) {
  return client.sites.some((site) => site.enabled);
}

export function getConnectedSites(client: ClientRegistry): SiteRegistry[] {
  return client.sites.filter((site) => site.enabled);
}
