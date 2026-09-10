import type { SiteSourceCollectors } from "../../src/modules/data-ingestion/index.ts";
import {
  createTopvisorClient,
  readTopvisorEnvironment,
} from "../sources/topvisor/client.ts";
import {
  createMetricaClient,
  readMetricaEnvironment,
} from "../sources/yandex-metrica/client.ts";
import {
  createWebmasterClient,
  readWebmasterEnvironment,
} from "../sources/yandex-webmaster/client.ts";

export type {
  MetricaCollectOptions,
  SiteSourceCollectors,
  TopvisorCollectOptions,
  WebmasterCollectOptions,
} from "../../src/modules/data-ingestion/index.ts";

export function createLiveSiteCollectors(
  env: NodeJS.ProcessEnv = process.env,
): SiteSourceCollectors {
  const webmasterCollectors = new Map<string, SiteSourceCollectors["webmaster"]>();
  const metricaCollectors = new Map<string, SiteSourceCollectors["metrica"]>();
  let topvisorCollect: SiteSourceCollectors["topvisor"] | null = null;

  return {
    async webmaster(site, options) {
      let collect = webmasterCollectors.get(site.siteSlug);
      if (!collect) {
        const config = readWebmasterEnvironment({
          ...env,
          YANDEX_WEBMASTER_SITE_URL: site.siteUrl,
        });
        const client = createWebmasterClient(config);
        collect = (_site, collectOptions) => client.collectSiteData(collectOptions);
        webmasterCollectors.set(site.siteSlug, collect);
      }
      return collect(site, options);
    },
    async metrica(site, options) {
      let collect = metricaCollectors.get(site.siteSlug);
      if (!collect) {
        const config = readMetricaEnvironment({
          ...env,
          YANDEX_METRICA_SITE_URL: site.siteUrl,
        });
        const client = createMetricaClient(config);
        collect = (_site, collectOptions) => client.collectSiteData(collectOptions);
        metricaCollectors.set(site.siteSlug, collect);
      }
      return collect(site, options);
    },
    async topvisor(site, options) {
      if (!topvisorCollect) {
        const config = readTopvisorEnvironment(env);
        const client = createTopvisorClient(config);
        topvisorCollect = (targetSite, collectOptions) =>
          client.collectSiteData(targetSite, collectOptions);
      }
      return topvisorCollect(site, options);
    },
  };
}
