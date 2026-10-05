import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { ProjectAckCredential } from "../contracts.ts";
import type { SnapshotDeliveryRepository } from "./ports/snapshot-delivery-repository.ts";

const TOKEN_PATTERN = /^scrypt\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$/u;

export function hashProjectAckToken(token: string, salt = randomBytes(16)): string {
  if (token.length < 32) throw new Error("ACK_TOKEN_TOO_SHORT");
  const digest = scryptSync(token, salt, 32);
  return `scrypt$${Buffer.from(salt).toString("base64url")}$${digest.toString("base64url")}`;
}

export function verifyProjectAckToken(token: string, storedHash: string): boolean {
  const match = TOKEN_PATTERN.exec(storedHash);
  if (!match) return false;
  try {
    const salt = Buffer.from(match[1]!, "base64url");
    const expected = Buffer.from(match[2]!, "base64url");
    const actual = scryptSync(token, salt, expected.byteLength);
    return actual.byteLength === expected.byteLength && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function idempotencyHash(value: string): string {
  if (value.length < 16 || value.length > 240) throw new Error("ACK_IDEMPOTENCY_KEY_INVALID");
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function createSnapshotAckService(dependencies: { repository: SnapshotDeliveryRepository; now(): Date }) {
  return {
    initializeCredential(input: { organizationId: string; projectId: string; token: string }) {
      return dependencies.repository.saveAckCredential({
        organizationId: input.organizationId,
        projectId: input.projectId,
        currentTokenHash: hashProjectAckToken(input.token),
        nextTokenHash: null,
        expectedVersion: 0,
        rotatedAt: null,
      });
    },
    stageRotation(credential: ProjectAckCredential, nextToken: string) {
      if (credential.nextTokenHash) throw new Error("ACK_ROTATION_ALREADY_STAGED");
      return dependencies.repository.saveAckCredential({
        organizationId: credential.organizationId,
        projectId: credential.projectId,
        currentTokenHash: credential.currentTokenHash,
        nextTokenHash: hashProjectAckToken(nextToken),
        expectedVersion: credential.version,
        rotatedAt: null,
      });
    },
    promoteRotation(credential: ProjectAckCredential) {
      if (!credential.nextTokenHash) throw new Error("ACK_ROTATION_NOT_STAGED");
      return dependencies.repository.saveAckCredential({
        organizationId: credential.organizationId,
        projectId: credential.projectId,
        currentTokenHash: credential.nextTokenHash,
        nextTokenHash: null,
        expectedVersion: credential.version,
        rotatedAt: dependencies.now(),
      });
    },
    async acknowledge(input: {
      organizationId: string;
      projectId: string;
      publishSequence: number;
      token: string;
      idempotencyKey: string;
    }) {
      const credential = await dependencies.repository.getAckCredential(input.organizationId, input.projectId);
      if (!credential) throw new Error("ACK_CREDENTIAL_NOT_CONFIGURED");
      const authenticated = verifyProjectAckToken(input.token, credential.currentTokenHash)
        || (credential.nextTokenHash !== null && verifyProjectAckToken(input.token, credential.nextTokenHash));
      if (!authenticated) throw new Error("ACK_AUTHENTICATION_FAILED");
      return dependencies.repository.acknowledgeApplied({
        organizationId: input.organizationId,
        projectId: input.projectId,
        publishSequence: input.publishSequence,
        idempotencyKeyHash: idempotencyHash(input.idempotencyKey),
        acknowledgedAt: dependencies.now(),
      });
    },
  };
}
