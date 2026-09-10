import { describe, expect, it } from "vitest";
import { getSeoConversionGoalIds } from "../collector/orchestration/metrica-site-config.ts";

const goal = (goalId: string, includeInSeoConversion: boolean) => ({
  goalId,
  label: `Goal ${goalId}`,
  category: "lead_submit" as const,
  direction: "primary" as const,
  includeInSeoConversion,
});

describe("Metrica goal configuration", () => {
  it("uses only explicitly included goals for unique SEO conversion", () => {
    expect(
      getSeoConversionGoalIds([
        goal("included", true),
        goal("detail-only", false),
      ]),
    ).toEqual(["included"]);
  });
});
