import { describe, expect, it } from "vitest";
import {
  assertEqualPeriodLength,
  derivePeriodEndingOn,
  derivePreviousPeriod,
  getInclusivePeriodDays,
  REPORT_PERIOD_KEYS,
} from "../src/modules/reporting/index.ts";

describe("equal comparison periods", () => {
  it("derives the immediately preceding period with equal inclusive length", () => {
    const current = { dateFrom: "2026-08-01", dateTo: "2026-08-28" };
    const previous = derivePreviousPeriod(current);

    expect(previous).toEqual({ dateFrom: "2026-07-04", dateTo: "2026-07-31" });
    expect(getInclusivePeriodDays(current)).toBe(28);
    expect(() => assertEqualPeriodLength(current, previous)).not.toThrow();
  });

  it("handles month and leap-day boundaries in UTC", () => {
    expect(
      derivePreviousPeriod({ dateFrom: "2024-03-01", dateTo: "2024-03-07" }),
    ).toEqual({ dateFrom: "2024-02-23", dateTo: "2024-02-29" });
  });

  it("rejects mismatched periods", () => {
    expect(() =>
      assertEqualPeriodLength(
        { dateFrom: "2026-08-01", dateTo: "2026-08-07" },
        { dateFrom: "2026-07-01", dateTo: "2026-07-06" },
      ),
    ).toThrow("Period length mismatch");
  });

  it("defines approved fixed presets ending on the same factual day", () => {
    expect(REPORT_PERIOD_KEYS).toEqual(["week", "month", "quarter", "halfYear"]);
    expect(getInclusivePeriodDays(derivePeriodEndingOn("2026-08-23", "week"))).toBe(7);
    expect(getInclusivePeriodDays(derivePeriodEndingOn("2026-08-23", "month"))).toBe(28);
    expect(getInclusivePeriodDays(derivePeriodEndingOn("2026-08-23", "quarter"))).toBe(90);
    expect(getInclusivePeriodDays(derivePeriodEndingOn("2026-08-23", "halfYear"))).toBe(180);
  });
});
