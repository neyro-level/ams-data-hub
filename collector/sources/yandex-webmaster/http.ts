import { webmasterSafeErrorCodeSchema, type WebmasterSafeErrorCode } from "../../../src/shared/schemas/webmaster-source.ts";

export class WebmasterSafeError extends Error {
  code: WebmasterSafeErrorCode;
  endpoint: string;
  status: number | null;
  retryable: boolean;
  details: Record<string, unknown>;

  constructor(args: {
    code: WebmasterSafeErrorCode;
    endpoint: string;
    message: string;
    status?: number | null;
    retryable?: boolean;
    details?: Record<string, unknown>;
  }) {
    super(args.message);
    this.name = "WebmasterSafeError";
    this.code = webmasterSafeErrorCodeSchema.parse(args.code);
    this.endpoint = args.endpoint;
    this.status = args.status ?? null;
    this.retryable = args.retryable ?? false;
    this.details = args.details ?? {};
  }
}

export type FetchLike = typeof fetch;
export type QueryValue = string | number | null | undefined | Array<string | number>;

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
    return {
      errorCode: typeof body.error_code === "string" ? body.error_code : null,
      availableUserId:
        typeof body.available_user_id === "number" || typeof body.available_user_id === "string"
          ? String(body.available_user_id)
          : null,
    };
  } catch {
    return {};
  }
}

async function mapResponseError(response: Response, endpoint: string) {
  const details = await parseSafeErrorDetails(response);

  if (response.status === 401) {
    return new WebmasterSafeError({
      code: "UNAUTHORIZED",
      endpoint,
      status: 401,
      message: `Yandex Webmaster GET failed with HTTP 401 for ${endpoint}`,
      details,
    });
  }

  if (response.status === 403) {
    return new WebmasterSafeError({
      code: "FORBIDDEN",
      endpoint,
      status: 403,
      message: `Yandex Webmaster GET failed with HTTP 403 for ${endpoint}`,
      details,
    });
  }

  if (response.status === 404) {
    return new WebmasterSafeError({
      code: "NOT_FOUND",
      endpoint,
      status: 404,
      message: `Yandex Webmaster GET failed with HTTP 404 for ${endpoint}`,
      details,
    });
  }

  if (response.status === 429) {
    return new WebmasterSafeError({
      code: "RATE_LIMITED",
      endpoint,
      status: 429,
      message: `Yandex Webmaster GET failed with HTTP 429 for ${endpoint}`,
      details,
    });
  }

  if (response.status >= 500) {
    return new WebmasterSafeError({
      code: "SERVER_ERROR",
      endpoint,
      status: response.status,
      message: `Yandex Webmaster GET failed with HTTP ${response.status} for ${endpoint}`,
      retryable: true,
      details,
    });
  }

  return new WebmasterSafeError({
    code: "INVALID_RESPONSE",
    endpoint,
    status: response.status,
    message: `Yandex Webmaster GET failed with HTTP ${response.status} for ${endpoint}`,
    details,
  });
}

export async function getWebmasterJson(args: {
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
      if (error instanceof WebmasterSafeError) {
        throw error;
      }

      if (attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        continue;
      }

      throw new WebmasterSafeError({
        code: "NETWORK_ERROR",
        endpoint: args.endpoint,
        message: `Yandex Webmaster GET failed for ${args.endpoint}`,
        retryable: false,
      });
    }
  }

  throw new WebmasterSafeError({
    code: "NETWORK_ERROR",
    endpoint: args.endpoint,
    message: `Yandex Webmaster GET failed for ${args.endpoint}`,
  });
}

export async function postWebmasterJson(args: {
  baseUrl: string; token: string; endpoint: string; body: unknown; fetchImpl?: FetchLike; retryDelayMs?: number;
}) {
  const fetchImpl = args.fetchImpl ?? fetch;
  const retryDelayMs = args.retryDelayMs ?? 250;
  const url = buildUrl(args.baseUrl, args.endpoint);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetchImpl(url, { method: "POST", headers: { Authorization: `OAuth ${args.token}`, Accept: "application/json", "Content-Type": "application/json; charset=UTF-8" }, body: JSON.stringify(args.body) });
      if (!response.ok) {
        const mapped = await mapResponseError(response, args.endpoint);
        if (mapped.retryable && attempt === 0) { await new Promise((resolve) => setTimeout(resolve, retryDelayMs)); continue; }
        throw mapped;
      }
      return (await response.json()) as unknown;
    } catch (error) {
      if (error instanceof WebmasterSafeError) throw error;
      if (attempt === 0) { await new Promise((resolve) => setTimeout(resolve, retryDelayMs)); continue; }
      throw new WebmasterSafeError({ code: "NETWORK_ERROR", endpoint: args.endpoint, message: `Yandex Webmaster POST failed for ${args.endpoint}`, retryable: false });
    }
  }
  throw new WebmasterSafeError({ code: "NETWORK_ERROR", endpoint: args.endpoint, message: `Yandex Webmaster POST failed for ${args.endpoint}` });
}
