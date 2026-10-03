export type CanonicalJsonValue =
  | null
  | boolean
  | number
  | string
  | CanonicalJsonValue[]
  | { readonly [key: string]: CanonicalJsonValue };

function serialize(value: unknown, seen: WeakSet<object>): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Canonical JSON forbids non-finite numbers");
    return JSON.stringify(value);
  }
  if (typeof value !== "object") {
    throw new Error("Canonical JSON accepts only JSON-compatible values");
  }
  if (seen.has(value)) throw new Error("Canonical JSON forbids cyclic values");
  seen.add(value);

  if (Array.isArray(value)) {
    const result = `[${value.map((item) => serialize(item, seen)).join(",")}]`;
    seen.delete(value);
    return result;
  }

  const prototype = Object.getPrototypeOf(value) as object | null;
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error("Canonical JSON accepts only plain objects and arrays");
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const entries = keys.map((key) => `${JSON.stringify(key)}:${serialize(record[key], seen)}`);
  seen.delete(value);
  return `{${entries.join(",")}}`;
}

export function canonicalJson(value: CanonicalJsonValue): string {
  return serialize(value, new WeakSet());
}

export function canonicalJsonBytes(value: CanonicalJsonValue): Uint8Array {
  return new TextEncoder().encode(canonicalJson(value));
}
