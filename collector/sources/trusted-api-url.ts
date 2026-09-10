export function requireTrustedApiBaseUrl(
  value: string,
  expected: {
    origin: string;
    pathname: string;
  },
) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Provider API base URL is invalid");
  }

  const normalizedPath = parsed.pathname.replace(/\/+$/, "") || "/";
  const expectedPath = expected.pathname.replace(/\/+$/, "") || "/";

  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.origin !== expected.origin ||
    normalizedPath !== expectedPath ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    throw new Error("Provider API base URL is not allowlisted");
  }

  return `${parsed.origin}${expectedPath === "/" ? "" : expectedPath}`;
}
