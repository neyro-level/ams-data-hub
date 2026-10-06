import type { CanonicalJsonValue } from "@ams-data-hub/data-contracts";
import { descriptionHtmlSafeSchema } from "@ams-data-hub/realty-contracts";
import { SnapshotCompositionError } from "./snapshot-error.ts";

const forbiddenKeyPatterns = [
  /^apartmentnumberprivate$/u,
  /(?:^|_)rawhtml$/u,
  /(?:^|_)feedhtml$/u,
  /^rawdescriptionhtml$/u,
  /^(?:canonical)?sourceurl$/u,
  /endpoint(?:url)?$/u,
  /credential(?:s|ref|refs)?$/u,
  /(?:secret|password|token|apikey)$/u,
  /^privatekey$/u,
  /^sourcesecret$/u,
  /^consent/u,
  /^private(?:phone|email)$/u,
  /^feedphoto(?:media)?id$/u,
  /^(?:private)?phonenorm(?:alized)?$/u,
  /^(?:private)?emailnorm(?:alized)?$/u,
  /^rawagentmatchingevidence$/u,
  /^rawimportissuepayload$/u,
  /^importissuepayload$/u,
] as const;

const htmlTagPattern = /<\/?[a-z][^>]*>/iu;

function normalizedKey(key: string): string {
  return key.normalize("NFKC").replace(/[^a-zA-Z0-9]/gu, "").toLowerCase();
}

function scan(value: CanonicalJsonValue, path: string): void {
  if (typeof value === "string") {
    if (htmlTagPattern.test(value)) {
      throw new SnapshotCompositionError("SNAPSHOT_PRIVACY_RAW_HTML", path);
    }
    return;
  }
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => scan(item, `${path}[${index}]`));
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    const keyToken = normalizedKey(key);
    if (forbiddenKeyPatterns.some((pattern) => pattern.test(keyToken))) {
      throw new SnapshotCompositionError("SNAPSHOT_PRIVACY_FORBIDDEN_FIELD", `${path}.${key}`);
    }
    if (key === "descriptionHtmlSafe") {
      if (!descriptionHtmlSafeSchema.safeParse(nested).success) {
        throw new SnapshotCompositionError("SNAPSHOT_PRIVACY_RAW_HTML", `${path}.${key}`);
      }
    } else {
      scan(nested, `${path}.${key}`);
    }
  }
}

export function assertSnapshotPrivacySafe(value: CanonicalJsonValue, path = "$snapshot"): void {
  scan(value, path);
}
