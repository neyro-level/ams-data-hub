import { DATA_SCHEMA_MAJOR, DATA_SCHEMA_MINOR, canonicalJson, createPublicDtoMapper, createPublicUrlId, createUlid, createVersionedContractSchema, cuidSchema, publicUrlIdSchema, serializePublicDto, ulidSchema } from "@ams-data-hub/data-contracts";
import { realtyEntityReferenceSchema } from "@ams-data-hub/realty-contracts";
import { describe, expect, it } from "vitest";
import { z } from "zod";

describe("identity contracts", () => {
  it("validates cuid, ULID and short public URL identifiers", () => {
    expect(cuidSchema.parse(`c${"a".repeat(24)}`)).toHaveLength(25);
    expect(ulidSchema.parse(createUlid(1_700_000_000_000))).toMatch(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
    expect(publicUrlIdSchema.parse(createPublicUrlId())).toMatch(/^[0-9a-hjkmnp-tv-z]{16}$/);
  });

  it("pins schemaMajor/schemaMinor in versioned and realty contracts", () => {
    const schema = createVersionedContractSchema(z.object({ name: z.string() }).strict());
    expect(schema.parse({ schemaMajor: DATA_SCHEMA_MAJOR, schemaMinor: DATA_SCHEMA_MINOR, payload: { name: "Synthetic entity" } })).toBeTruthy();
    expect(realtyEntityReferenceSchema.parse({ schemaMajor: DATA_SCHEMA_MAJOR, schemaMinor: DATA_SCHEMA_MINOR, uid: createUlid(), publicUrlId: createPublicUrlId() })).toBeTruthy();
  });

  it("serializes JSON deterministically with sorted object keys", () => {
    expect(canonicalJson({ z: 1, a: { y: true, b: [2, 1] } })).toBe('{"a":{"b":[2,1],"y":true},"z":1}');
    expect(() => canonicalJson({ value: Number.NaN })).toThrow("non-finite");
  });
});

describe("public DTO guard", () => {
  const publicEntitySchema = z.object({ uid: ulidSchema, publicUrlId: publicUrlIdSchema, name: z.string() }).strict();

  it("rejects a raw Prisma-like row and serializes only an explicit whitelist projection", () => {
    const rawPersistenceRow = { id: `c${"a".repeat(24)}`, uid: createUlid(), publicUrlId: createPublicUrlId(), name: "Synthetic development", internalRevision: 7, privateNote: "must-not-leak" };
    const mapPublicEntity = createPublicDtoMapper(publicEntitySchema, (row: typeof rawPersistenceRow) => ({ uid: row.uid, publicUrlId: row.publicUrlId, name: row.name }));
    expect(() => serializePublicDto(rawPersistenceRow)).toThrow("Raw persistence records");
    expect(() => publicEntitySchema.parse(rawPersistenceRow)).toThrow();
    const serialized = serializePublicDto(mapPublicEntity(rawPersistenceRow));
    expect(serialized).toContain("Synthetic development");
    expect(serialized).not.toContain("internalRevision");
    expect(serialized).not.toContain("privateNote");
    expect(serialized).not.toContain(rawPersistenceRow.id);
  });
});
