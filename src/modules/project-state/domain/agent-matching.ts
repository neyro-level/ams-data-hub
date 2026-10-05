import { createHash } from "node:crypto";
import { parsePhoneNumberFromString } from "libphonenumber-js";

export interface NormalizedAgentEvidence {
  evidenceKey: string;
  fullNameRaw: string;
  normalizedFullName: string;
  phoneRaw: string | null;
  phoneNorm: string | null;
  photoSourceUrl: string | null;
  categoryRaw: string | null;
  offerExternalIds: readonly string[];
}

export function normalizeAgentFullName(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("ru-RU");
}

export function normalizeAgentEvidence(input: {
  sourceId: string;
  fullNameRaw: string;
  phoneRaw?: string;
  photoSourceUrl?: string;
  categoryRaw?: string;
  offerExternalIds: readonly string[];
}): NormalizedAgentEvidence {
  const fullNameRaw = input.fullNameRaw.normalize("NFKC").trim().replace(/\s+/gu, " ");
  const normalizedFullName = normalizeAgentFullName(fullNameRaw);
  if (!normalizedFullName) throw new Error("AGENT_SOURCE_NAME_REQUIRED");
  const phoneRaw = input.phoneRaw?.trim() || null;
  const parsedPhone = phoneRaw ? parsePhoneNumberFromString(phoneRaw, "RU") : undefined;
  const phoneNorm = parsedPhone?.isValid() ? parsedPhone.number : null;
  const evidenceKey = createHash("sha256")
    .update(`${input.sourceId}\u0000${phoneNorm ?? phoneRaw ?? ""}\u0000${normalizedFullName}`)
    .digest("hex");
  return {
    evidenceKey,
    fullNameRaw,
    normalizedFullName,
    phoneRaw,
    phoneNorm,
    photoSourceUrl: input.photoSourceUrl?.trim() || null,
    categoryRaw: input.categoryRaw?.trim() || null,
    offerExternalIds: [...new Set(input.offerExternalIds.map((value) => value.trim()).filter(Boolean))],
  };
}

export function ambiguousPhoneNames(evidence: readonly NormalizedAgentEvidence[]): ReadonlySet<string> {
  const namesByPhone = new Map<string, Set<string>>();
  for (const item of evidence) {
    if (!item.phoneNorm) continue;
    const names = namesByPhone.get(item.phoneNorm) ?? new Set<string>();
    names.add(item.normalizedFullName);
    namesByPhone.set(item.phoneNorm, names);
  }
  return new Set([...namesByPhone].filter(([, names]) => names.size > 1).map(([phone]) => phone));
}
