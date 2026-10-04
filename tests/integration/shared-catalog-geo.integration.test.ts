import { createUlid } from "@ams-data-hub/data-contracts";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { readTestDatabaseTarget } from "../../scripts/verify-test-database-env.mjs";
import type {
  PlatformAdminPrincipal,
  TenantUserPrincipal,
} from "../../src/platform/authorization/principal.ts";
import { runInPrincipalDatabaseTransaction } from "../../src/platform/database/transaction.ts";

const target = readTestDatabaseTarget(process.env, { allowApplicationTarget: true });

function platformAdmin(): PlatformAdminPrincipal {
  return { kind: "platform-admin", userId: `catalog-admin-${randomUUID()}`, correlationId: randomUUID() };
}

function tenantUser(): TenantUserPrincipal {
  return {
    kind: "tenant-user",
    userId: `catalog-tenant-${randomUUID()}`,
    organizationId: `catalog-org-${randomUUID()}`,
    membershipId: `catalog-member-${randomUUID()}`,
    role: "ORG_ADMIN",
    projectIds: "*",
    correlationId: randomUUID(),
  };
}

async function withWebRole<T>(
  principalKind: "platform-admin" | "tenant-user",
  execute: (client: pg.Client) => Promise<T>,
): Promise<T> {
  const client = new pg.Client({
    host: target.host,
    port: target.port,
    database: target.database,
    user: target.user,
    password: target.password,
    ssl: target.sslmode === "require",
  });
  await client.connect();
  try {
    await client.query("set role ams_data_hub_web");
    await client.query("begin");
    await client.query("select set_config('app.principal_kind', $1, true)", [principalKind]);
    await client.query("select set_config('app.actor_id', $1, true)", [`catalog-${principalKind}`]);
    await client.query("select set_config('app.organization_id', $1, true)", [
      principalKind === "tenant-user" ? "catalog-test-organization" : "",
    ]);
    const result = await execute(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.end();
  }
}

describe("shared catalog geo persistence", () => {
  it("seeds required subjects and cities with aliases and lifecycle", async () => {
    const regions = await runInPrincipalDatabaseTransaction(tenantUser(), (transaction) =>
      transaction.region.findMany({
        orderBy: { code: "asc" },
        include: { aliases: { orderBy: { normalizedValue: "asc" } }, cities: true },
      }));
    expect(regions.map((region) => region.code)).toEqual(["RU-CR", "RU-KDA", "RU-ROS", "RU-SEV"]);
    expect(regions.every((region) => region.lifecycle === "ACTIVE" && region.aliases.length === 1)).toBe(true);
    expect(regions.flatMap((region) => region.cities).map((city) => city.name).sort()).toEqual([
      "Краснодар",
      "Ростов-на-Дону",
      "Севастополь",
    ]);
  });

  it("allows platform-admin district maintenance but denies tenant writes and uid mutation", async () => {
    const krasnodar = await runInPrincipalDatabaseTransaction(platformAdmin(), (transaction) =>
      transaction.city.findFirstOrThrow({ where: { normalizedName: "краснодар" }, select: { uid: true } }));
    const districtUid = createUlid();
    await withWebRole("platform-admin", async (client) => {
      await client.query(
        "insert into \"District\" (\"uid\", \"cityUid\", \"name\", \"normalizedName\", \"updatedAt\") values ($1, $2, $3, $4, now())",
        [districtUid, krasnodar.uid, "Центральный", "центральный"],
      );
      await client.query(
        "insert into \"DistrictAlias\" (\"districtUid\", \"value\", \"normalizedValue\") values ($1, $2, $3)",
        [districtUid, "Центр", "центр"],
      );
    });

    await expect(withWebRole("tenant-user", (client) =>
      client.query(
        "insert into \"District\" (\"uid\", \"cityUid\", \"name\", \"normalizedName\", \"updatedAt\") values ($1, $2, $3, $4, now())",
        [createUlid(), krasnodar.uid, "Запрещённый", "запрещённый"],
      ))).rejects.toMatchObject({ code: "42501" });

    await expect(withWebRole("platform-admin", (client) =>
      client.query("update \"District\" set \"uid\" = $1 where \"uid\" = $2", [
        createUlid(),
        districtUid,
      ]))).rejects.toMatchObject({ code: "23514" });

    const visible = await withWebRole("tenant-user", (client) =>
      client.query(
        "select d.\"uid\", a.\"normalizedValue\" from \"District\" d join \"DistrictAlias\" a on a.\"districtUid\" = d.\"uid\" where d.\"uid\" = $1",
        [districtUid],
      ));
    expect(visible.rows).toEqual([{ uid: districtUid, normalizedValue: "центр" }]);
  });
});
