const invalid = () => new Error("SNAPSHOT_PUBLIC_ADDRESS_INVALID");
const unit = /(?<![\p{L}\p{N}])(?:квартира|кв|апартаменты?|комната|комн|помещение|пом|apartment|apt|flat|unit|suite|room)(?:\.?\s*[№#]\s*|\.\s*|\s+|(?=\p{N}))[\p{L}\p{N}]+[^,;]*/giu;
const unresolvedUnit = /(?<![\p{L}\p{N}])(?:квартира|кв|апартаменты?|комната|комн|помещение|пом|apartment|apt|flat|unit|suite|room)(?![\p{L}\p{N}])/iu;
const house = /(?<![\p{L}\p{N}])(?:дом|д|house|building|корпус|корп|строение|стр)(?:\.\s*|\s+)[\p{L}\p{N}]+(?:\s*[-/]\s*[\p{L}\p{N}]+)*/giu;
const forbidden = /[<>@\p{Cc}\p{Cf}]|https?:\/\/|www\.|\+\d[\d()\s-]{8,}/iu;
const compact = (value: string) => value.trim().replace(/\s*([/-])\s*/gu, "$1");
function escape(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"); }

/** No raw address fallback: strip explicit unit components and the captured
 * private marker; ambiguous surviving private values fail closed. */
export function normalizeSnapshotPublicAddress(raw: string, privateApartment?: string): string {
  if (raw.length > 2000 || forbidden.test(raw)) throw invalid();
  // NFKC turns the numero sign into the letters "No"; preserve its marker role.
  let value = raw.replace(/№/gu, "#").normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (forbidden.test(value)) throw invalid();
  value = value.replace(unit, "");
  if (unresolvedUnit.test(value)) throw invalid();
  if (privateApartment !== undefined) {
    const marker = compact(privateApartment.trim().replace(/^[№#]\s*/u, "").normalize("NFKC"));
    if (!/^[\p{L}\p{N}]+(?:[-/][\p{L}\p{N}]+)?$/u.test(marker) || marker.length > 100) throw invalid();
    // Attached alphabetic units have no boundary between label and private value.
    // Match only the exact captured marker, not arbitrary street-name prefixes.
    const markerPattern = marker.split(/([/-])/u).map((part) => part === "/" || part === "-" ? `\\s*${part}\\s*` : escape(part)).join("");
    value = value.replace(new RegExp(`(?<![\\p{L}\\p{N}])(?:квартира|кв|апартаменты?|комната|комн|помещение|пом|apartment|apt|flat|unit|suite|room)${markerPattern}(?![\\p{L}\\p{N}])[^,;]*`, "giu"), "");
    // Only a complete comma/semicolon component can be removed without guessing.
    value = value.split(/[,;]/u).filter((component) => compact(component) !== marker).join(", ");
    const remaining = compact(value.replace(house, ""));
    // An unknown/obfuscated attached label must not hide the captured marker.
    if (new RegExp(`(?<![\\p{N}])${escape(marker)}(?![\\p{L}\\p{N}])`, "iu").test(remaining)) throw invalid();
  }
  value = value.replace(/(?:\s*[,;]\s*){2,}/gu, ", ").replace(/^[,;\s]+|[,;\s]+$/gu, "").replace(/\s+/gu, " ");
  if (!value || value.length > 1000) throw invalid();
  return value;
}
