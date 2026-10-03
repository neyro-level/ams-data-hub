export function normalizeGeoName(value: string): string {
  const normalized = value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("ru-RU");
  if (!normalized) throw new Error("Catalog geo name cannot be empty");
  if (normalized.length > 160) throw new Error("Catalog geo name exceeds 160 characters");
  return normalized;
}
