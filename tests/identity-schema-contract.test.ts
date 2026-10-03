import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const rootDir = path.resolve(import.meta.dirname, "..");
const schema = readFileSync(path.join(rootDir, "prisma", "schema.prisma"), "utf8");
const migration = readFileSync(path.join(rootDir, "prisma", "migrations", "20261003194000_identity_contracts", "migration.sql"), "utf8");

describe("publicUrlId reservation schema", () => {
  it("binds reservations to a project and keeps the identifier non-reusable", () => {
    expect(schema).toContain("model PublicUrlIdReservation");
    expect(schema).toContain("@@unique([projectId, publicUrlId])");
    expect(migration).toContain('BEFORE UPDATE OR DELETE ON "PublicUrlIdReservation"');
    expect(migration).toContain("PublicUrlId reservations are immutable and cannot be reused");
  });
  it("enforces ULID/publicUrlId grammar and tenant RLS in PostgreSQL", () => {
    expect(migration).toContain("PublicUrlIdReservation_subjectUid_check");
    expect(migration).toContain("PublicUrlIdReservation_publicUrlId_check");
    expect(migration).toContain('ALTER TABLE "PublicUrlIdReservation" FORCE ROW LEVEL SECURITY');
    expect(migration).toContain("current_setting('app.organization_id', true)");
  });
});
