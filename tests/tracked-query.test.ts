import northQueries from "../config/examples/tracked-queries/alpha-north.json";
import { describe, expect, it } from "vitest";
import { trackedQuerySetSchema } from "../src/shared/schemas/tracked-query.ts";

describe("tracked SEO query core", () => {
  it("loads only the bounded synthetic example", () => {
    const parsed = trackedQuerySetSchema.parse(northQueries);

    expect(parsed.expectedCount).toBe(5);
    expect(parsed.queries).toHaveLength(5);
  });

  it("preserves top-3 as a subset of top-10", () => {
    const parsed = trackedQuerySetSchema.parse(northQueries);
    const current = parsed.queries
      .map((query) => query.position.current)
      .filter((position): position is number => position !== null);
    const baseline = parsed.queries
      .map((query) => query.position.baseline)
      .filter((position): position is number => position !== null);
    const improved = parsed.queries.filter(
      (query) =>
        query.position.current !== null &&
        query.position.baseline !== null &&
        query.position.current < query.position.baseline,
    ).length;
    const declined = parsed.queries.filter(
      (query) =>
        query.position.current !== null &&
        query.position.baseline !== null &&
        query.position.current > query.position.baseline,
    ).length;

    expect(current.filter((position) => position <= 10)).toHaveLength(3);
    expect(current.filter((position) => position <= 3)).toHaveLength(1);
    expect(baseline.filter((position) => position <= 10)).toHaveLength(3);
    expect(baseline.filter((position) => position <= 3)).toHaveLength(1);
    expect({ improved, declined }).toEqual({ improved: 3, declined: 1 });
  });

  it("preserves the supplied position baseline without inventing a year", () => {
    const parsed = trackedQuerySetSchema.parse(northQueries);
    const query = parsed.queries.find(
      (item) => item.query === "новостройки северный район",
    );

    expect(parsed.baselineLabel).toBe("synthetic-baseline");
    expect(query?.position).toEqual({ current: 4, baseline: 9, delta: 5 });
  });

  it("keeps core queries without a measured position as nullable evidence", () => {
    const parsed = trackedQuerySetSchema.parse(northQueries);
    const query = parsed.queries.find((item) => item.query === "этапы строительства дома");

    expect(query).toMatchObject({
      position: { current: null, baseline: null, delta: 0 },
    });
  });
});
