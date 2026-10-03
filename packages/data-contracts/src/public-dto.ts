import type { z } from "zod";
import { canonicalJson, type CanonicalJsonValue } from "./canonical-json.ts";

const publicDtoMarker = Symbol("ams-data-hub.public-dto");

export type PublicDto<TValue extends object> = Readonly<TValue> & {
  readonly [publicDtoMarker]: true;
};

export function createPublicDtoMapper<TSource, TSchema extends z.ZodType>(
  schema: TSchema,
  project: (source: TSource) => z.input<TSchema>,
): (source: TSource) => PublicDto<z.output<TSchema> & object> {
  return (source) => {
    const parsed: unknown = schema.parse(project(source));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Public DTO schema must produce an object");
    }
    Object.defineProperty(parsed, publicDtoMarker, {
      value: true,
      enumerable: false,
      configurable: false,
      writable: false,
    });
    return Object.freeze(parsed) as PublicDto<z.output<TSchema> & object>;
  };
}

export function isPublicDto(value: unknown): value is PublicDto<Record<string, unknown>> {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && (value as { [publicDtoMarker]?: unknown })[publicDtoMarker] === true;
}

export function serializePublicDto(value: unknown): string {
  if (!isPublicDto(value)) {
    throw new Error("Raw persistence records cannot be serialized as public DTOs");
  }
  return canonicalJson(value as CanonicalJsonValue);
}
