import type { ReportPeriodKey } from "../../../shared/schemas/report.ts";

export type DatePeriod = {
  dateFrom: string;
  dateTo: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export const REPORT_PERIODS: Record<
  ReportPeriodKey,
  { label: string; days: number }
> = {
  week: { label: "Неделя", days: 7 },
  month: { label: "Месяц", days: 28 },
  quarter: { label: "Квартал", days: 90 },
  halfYear: { label: "Полгода", days: 180 },
};

export const REPORT_PERIOD_KEYS: ReportPeriodKey[] = [
  "week",
  "month",
  "quarter",
  "halfYear",
];

function parseDateOnly(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    throw new Error(`Invalid date-only value: ${value}`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day);
  const parsed = new Date(timestamp);

  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new Error(`Invalid calendar date: ${value}`);
  }

  return timestamp;
}

function formatDateOnly(timestamp: number) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

export function derivePeriodEndingOn(dateTo: string, periodKey: ReportPeriodKey): DatePeriod {
  const end = parseDateOnly(dateTo);
  const dateFrom = end - (REPORT_PERIODS[periodKey].days - 1) * DAY_MS;
  return {
    dateFrom: formatDateOnly(dateFrom),
    dateTo,
  };
}

export function getInclusivePeriodDays(period: DatePeriod) {
  const from = parseDateOnly(period.dateFrom);
  const to = parseDateOnly(period.dateTo);
  if (to < from) {
    throw new Error(`Period ends before it starts: ${period.dateFrom}..${period.dateTo}`);
  }

  return Math.floor((to - from) / DAY_MS) + 1;
}

export function derivePreviousPeriod(current: DatePeriod): DatePeriod {
  const currentFrom = parseDateOnly(current.dateFrom);
  const days = getInclusivePeriodDays(current);
  const previousTo = currentFrom - DAY_MS;
  const previousFrom = previousTo - (days - 1) * DAY_MS;

  return {
    dateFrom: formatDateOnly(previousFrom),
    dateTo: formatDateOnly(previousTo),
  };
}

export function assertEqualPeriodLength(current: DatePeriod, previous: DatePeriod) {
  const currentDays = getInclusivePeriodDays(current);
  const previousDays = getInclusivePeriodDays(previous);
  if (currentDays !== previousDays) {
    throw new Error(
      `Period length mismatch: current=${currentDays} days, previous=${previousDays} days`,
    );
  }
}
