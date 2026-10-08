import { describe,expect,it } from "vitest";
import { createOperationalAckRotationCapability } from "../src/infrastructure/ack-rotation-capability.ts";
import { requestOperationalActionInputSchema } from "../src/modules/operations-control/contracts.ts";
const scope = { organizationId: "synthetic-org",projectId: "synthetic-project" };
describe("explicit value-free ACK rotation capability",() => {
  it("ignores registry while disabled and requires an explicit true",() => {
    expect(createOperationalAckRotationCapability({})).toBeNull();
    expect(createOperationalAckRotationCapability({ ACK_ROTATION_ENABLED: "false",PROJECT_ACK_ROTATION_BINDINGS: "invalid" })).toBeNull();
    expect(() => createOperationalAckRotationCapability({ ACK_ROTATION_ENABLED: "1" })).toThrow("ACK_ROTATION_CAPABILITY_INVALID");
  });
  it.each([undefined,"", "invalid", "[]", JSON.stringify([{ ...scope,nextTokenRef: "invalid-ref" }]),
    JSON.stringify([1,2].map(() => ({ ...scope,nextTokenRef: "SYNTHETIC_ACK_NEXT" }))),
    JSON.stringify([{ ...scope,projectId: "*",nextTokenRef: "SYNTHETIC_ACK_NEXT" }])])("rejects malformed registry without exposing content (%#)",(value) => {
    expect(() => createOperationalAckRotationCapability({ ACK_ROTATION_ENABLED: "true",PROJECT_ACK_ROTATION_BINDINGS: value })).toThrow("ACK_ROTATION_BINDINGS_INVALID");
  });
  it("does not resolve token values at startup",() => {
    const environment = { ACK_ROTATION_ENABLED: "true",PROJECT_ACK_ROTATION_BINDINGS: JSON.stringify([{ ...scope,nextTokenRef: "SYNTHETIC_ACK_NEXT" }]) };
    Object.defineProperty(environment,"SYNTHETIC_ACK_NEXT",{ get() { throw new Error("SYNTHETIC_SECRET_READ"); } });
    expect(createOperationalAckRotationCapability(environment)).toBeTypeOf("function");
  });
  it("requires explicit ACK-only phase/version and rejects invalid bounds",() => {
    const request = { ...scope,action: "ACK_ROTATE",idempotencyKey: "synthetic-ack" };
    expect(requestOperationalActionInputSchema.safeParse(request).success).toBe(false);
    for (const phase of ["STAGE","PROMOTE"]) {
      expect(requestOperationalActionInputSchema.safeParse({ ...request,ackRotationPhase: phase,ackCredentialVersion: 1 }).success).toBe(true);
      for (const version of [0,-1,1.5,2_147_483_647,"1"]) expect(requestOperationalActionInputSchema.safeParse({ ...request,ackRotationPhase: phase,ackCredentialVersion: version }).success).toBe(false);
    }
    expect(requestOperationalActionInputSchema.safeParse({ ...request,action: "SNAPSHOT_BUILD",ackRotationPhase: "STAGE",ackCredentialVersion: 1 }).success).toBe(false);
  });
});
