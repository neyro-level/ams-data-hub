import { createPublicUrlId, createUlid } from "@ams-data-hub/data-contracts";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { PlatformAdminPrincipal } from "../../src/platform/authorization/principal.ts";
import { runInPrincipalDatabaseTransaction } from "../../src/platform/database/transaction.ts";

function platformAdmin(): PlatformAdminPrincipal {
  return {
    kind: "platform-admin",
    userId: `identity-contract-admin-${randomUUID()}`,
    correlationId: randomUUID(),
  };
}

describe("identity reservation persistence", () => {
  it("creates a valid reservation and rejects mutation, deletion and reuse", async () => {
    const principal = platformAdmin();
    const project = await runInPrincipalDatabaseTransaction(principal, (transaction) =>
      transaction.project.findFirstOrThrow({ select: { id: true, organizationId: true } }));
    const subjectUid = createUlid();
    const publicUrlId = createPublicUrlId();
    const reservation = await runInPrincipalDatabaseTransaction(principal, (transaction) =>
      transaction.publicUrlIdReservation.create({
        data: {
          organizationId: project.organizationId,
          projectId: project.id,
          subjectType: "DEVELOPMENT",
          subjectUid,
          publicUrlId,
        },
        select: { id: true, subjectUid: true, publicUrlId: true },
      }));

    expect(reservation).toMatchObject({ subjectUid, publicUrlId });

    await expect(runInPrincipalDatabaseTransaction(principal, (transaction) =>
      transaction.publicUrlIdReservation.update({
        where: { id: reservation.id },
        data: { publicUrlId: createPublicUrlId() },
      }))).rejects.toThrow();

    await expect(runInPrincipalDatabaseTransaction(principal, (transaction) =>
      transaction.publicUrlIdReservation.delete({ where: { id: reservation.id } }))).rejects.toThrow();

    await expect(runInPrincipalDatabaseTransaction(principal, (transaction) =>
      transaction.publicUrlIdReservation.create({
        data: {
          organizationId: project.organizationId,
          projectId: project.id,
          subjectType: "DEVELOPMENT",
          subjectUid: createUlid(),
          publicUrlId,
        },
      }))).rejects.toThrow();
  });
});
