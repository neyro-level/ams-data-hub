import { metricaSafeErrorCodeSchema, type MetricaSafeErrorCode } from "../../../src/shared/schemas/metrica-source.ts";

export class MetricaSafeError extends Error {
  code: MetricaSafeErrorCode;
  endpoint: string;
  status: number | null;
  retryable: boolean;
  details: Record<string, unknown>;

  constructor(args: {
    code: MetricaSafeErrorCode;
    endpoint: string;
    message: string;
    status?: number | null;
    retryable?: boolean;
    details?: Record<string, unknown>;
  }) {
    super(args.message);
    this.name = "MetricaSafeError";
    this.code = metricaSafeErrorCodeSchema.parse(args.code);
    this.endpoint = args.endpoint;
    this.status = args.status ?? null;
    this.retryable = args.retryable ?? false;
    this.details = args.details ?? {};
  }
}

export type FetchLike = typeof fetch;
export type QueryValue = string | number | boolean | null | undefined | Array<string | number | boolean>;

function buildUrl(baseUrl: string, endpoint: string, query?: Record<string, QueryValue>) {
  const url = new URL(endpoint.replace(/^\//, ""), `${baseUrl.replace(/\/$/, "")}/`);
  for (const [key, rawValue] of Object.entries(query ?? {})) {
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    for (const value of values) {
      if (value === null || value === undefined || value === "") {
        continue;
      }
      url.searchParams.append(key, String(value));
    }
  }
  return url.toString();
}

async function parseSafeErrorDetails(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return {};
  }

  try {
    const body = (await response.json()) as Record<string, unknown>;
    const errors = Array.isArray(body.errors) ? body.errors : [];
    const firstError = errors.length > 0 ? (errors[0] as Record<string, unknown>) : null;
    return {
      code: typeof body.code === "number" ? body.code : null,
      message: typeof body.message === "string" ? body.message : null,
      errorType: firstError && typeof firstError.error_type === "string" ? firstError.error_type : null,
    };
  } catch {
    return {};
  }
}

async function mapResponseError(response: Response, endpoint: string) {
  const details = await parseSafeErrorDetails(response);

  if (response.status === 401) {
    return new MetricaSafeError({
      code: "UNAUTHORIZED",
      endpoint,
      status: 401,
      message: `Yandex Metrica GET failed with HTTP 401 for ${endpoint}`,
      details,
    });
  }

  if (response.status === 403) {
    return new MetricaSafeError({
      code: "FORBIDDEN",
      endpoint,
      status: 403,
      message: `Yandex Metrica GET failed with HTTP 403 for ${endpoint}`,
      details,
    });
  }

  if (response.status === 404) {
    return new MetricaSafeError({
      code: "NOT_FOUND",
      endpoint,
      status: 404,
      message: `Yandex Metrica GET failed with HTTP 404 for ${endpoint}`,
      details,
    });
  }

  if (response.status === 420) {
    return new MetricaSafeError({
      code: "RATE_LIMITED",
      endpoint,
      status: 420,
      message: `Yandex Metrica GET failed with HTTP 420 for ${endpoint}`,
      details,
    });
  }

  if (response.status >= 500) {
    return new MetricaSafeError({
      code: "SERVER_ERROR",
      endpoint,
      status: response.status,
      retryable: true,
      message: `Yandex Metrica GET failed with HTTP ${response.status} for ${endpoint}`,
      details,
    });
  }

  return new MetricaSafeError({
    code: "INVALID_RESPONSE",
    endpoint,
    status: response.status,
    message: `Yandex Metrica GET failed with HTTP ${response.status} for ${endpoint}`,
    details,
  });
}

export async function getMetricaJson(args: {
  baseUrl: string;
  token: string;
  endpoint: string;
  query?: Record<string, QueryValue>;
  fetchImpl?: FetchLike;
  retryDelayMs?: number;
}) {
  const fetchImpl = args.fetchImpl ?? fetch;
  const retryDelayMs = args.retryDelayMs ?? 250;
  const url = buildUrl(args.baseUrl, args.endpoint, args.query);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        method: "GET",
        headers: {
          Authorization: `OAuth ${args.token}`,
          Accept: "application/json",
          "Content-Type": "application/x-yametrika+json",
        },
      });

      if (!response.ok) {
        const mapped = await mapResponseError(response, args.endpoint);
        if (mapped.retryable && attempt === 0) {
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
          continue;
        }
        throw mapped;
      }

      return (await response.json()) as unknown;
    } catch (error) {
      if (error instanceof MetricaSafeError) {
        throw error;
      }

      if (attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        continue;
      }

      throw new MetricaSafeError({
        code: "NETWORK_ERROR",
        endpoint: args.endpoint,
        message: `Yandex Metrica GET failed for ${args.endpoint}`,
      });
    }
  }

  throw new MetricaSafeError({
    code: "NETWORK_ERROR",
    endpoint: args.endpoint,
    message: `Yandex Metrica GET failed for ${args.endpoint}`,
  });
}
