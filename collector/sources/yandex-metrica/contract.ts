export const METRICA_MANAGEMENT_BASE_PATH = "/management/v1";
export const METRICA_REPORTS_BASE_PATH = "/stat/v1";

export const METRICA_COUNTERS_ENDPOINT = `${METRICA_MANAGEMENT_BASE_PATH}/counters`;
export const METRICA_GOALS_ENDPOINT = (counterId: string) =>
  `${METRICA_MANAGEMENT_BASE_PATH}/counter/${counterId}/goals`;
export const METRICA_REPORT_TABLE_ENDPOINT = `${METRICA_REPORTS_BASE_PATH}/data`;
export const METRICA_REPORT_BYTIME_ENDPOINT = `${METRICA_REPORTS_BASE_PATH}/data/bytime`;

export const METRICA_REQUIRED_SCOPE = "metrika:read";
