import type {
  WebmasterQueryCollection,
  WebmasterQueryOrderBy,
} from "../../../shared/schemas/webmaster-source.ts";

export type MergedWebmasterQuery = {
  queryId: string;
  queryText: string;
  device: "ALL" | "DESKTOP" | "MOBILE" | "TABLET" | "MOBILE_AND_TABLET";
  shows: number;
  clicks: number;
  ctrPercent: number | null;
  avgShowPosition: number | null;
  avgClickPosition: number | null;
  observedBy: WebmasterQueryOrderBy[];
};

export type QueryOpportunity = {
  queryId: string;
  device: MergedWebmasterQuery["device"];
  type: "high_impressions_low_ctr" | "positions_4_10" | "positions_11_20" | "zero_clicks";
};


export function mergeWebmasterQueryCollections(
  collections: WebmasterQueryCollection[],
): MergedWebmasterQuery[] {
  const merged = new Map<string, MergedWebmasterQuery>();

  for (const collection of collections) {
    for (const query of collection.queries) {
      const key = `${query.queryId}::${query.device}`;
      const existing = merged.get(key);

      if (!existing) {
        merged.set(key, {
          queryId: query.queryId,
          queryText: query.queryText,
          device: query.device,
          shows: query.shows,
          clicks: query.clicks,
          ctrPercent:
            query.shows > 0
              ? Number(((query.clicks / query.shows) * 100).toFixed(2))
              : null,
          avgShowPosition: query.avgShowPosition,
          avgClickPosition: query.avgClickPosition,
          observedBy: [collection.orderBy],
        });
        continue;
      }

      if (existing.queryText !== query.queryText) {
        throw new Error(`Query text mismatch for ${query.queryId}/${query.device}`);
      }

      existing.shows = Math.max(existing.shows, query.shows);
      existing.clicks = Math.max(existing.clicks, query.clicks);
      existing.ctrPercent =
        existing.shows > 0
          ? Number(((existing.clicks / existing.shows) * 100).toFixed(2))
          : null;
      existing.avgShowPosition ??= query.avgShowPosition;
      existing.avgClickPosition ??= query.avgClickPosition;
      if (!existing.observedBy.includes(collection.orderBy)) {
        existing.observedBy.push(collection.orderBy);
      }
    }
  }

  return [...merged.values()].sort(
    (left, right) =>
      right.shows - left.shows ||
      right.clicks - left.clicks ||
      left.queryText.localeCompare(right.queryText, "ru"),
  );
}

export function buildQueryOpportunities(
  queries: MergedWebmasterQuery[],
  thresholds: {
    minimumShows: number;
    maximumCtrPercent: number;
    maximumAveragePosition: number;
  },
): QueryOpportunity[] {
  const opportunities: QueryOpportunity[] = [];

  for (const query of queries) {
    const position = query.avgShowPosition;
    if (
      query.shows >= thresholds.minimumShows &&
      query.ctrPercent !== null &&
      query.ctrPercent < thresholds.maximumCtrPercent &&
      position !== null &&
      position <= thresholds.maximumAveragePosition
    ) {
      opportunities.push({
        queryId: query.queryId,
        device: query.device,
        type: "high_impressions_low_ctr",
      });
    }

    if (position !== null && position >= 4 && position <= 10) {
      opportunities.push({
        queryId: query.queryId,
        device: query.device,
        type: "positions_4_10",
      });
    } else if (
      position !== null &&
      position >= 11 &&
      position <= 20 &&
      query.shows >= thresholds.minimumShows
    ) {
      opportunities.push({
        queryId: query.queryId,
        device: query.device,
        type: "positions_11_20",
      });
    }

    if (query.shows >= thresholds.minimumShows && query.clicks === 0) {
      opportunities.push({
        queryId: query.queryId,
        device: query.device,
        type: "zero_clicks",
      });
    }
  }

  return opportunities;
}
