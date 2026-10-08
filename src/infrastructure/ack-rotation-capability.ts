import "server-only";
import { z } from "zod";
import { createOperationalAckRotationExecutor } from "../modules/operations-control/server.ts";

const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u).refine((value) => !["__proto__", "prototype", "constructor"].includes(value));
const bindingSchema = z.object({ organizationId: id, projectId: id, nextTokenRef: z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/u) }).strict();
type Environment = Readonly<Record<string, string | undefined>>;
function registry(environment: Environment) {
  try {
    const raw = environment.PROJECT_ACK_ROTATION_BINDINGS;
    if (!raw || Buffer.byteLength(raw)>128*1024) throw new Error();
    const rows = z.array(bindingSchema).min(1).max(256).parse(JSON.parse(raw));
    const result = new Map<string, string>();
    for (const row of rows) {
      const key = JSON.stringify([row.organizationId,row.projectId]);
      if (result.has(key)) throw new Error(); result.set(key,row.nextTokenRef);
    }
    return result;
  } catch { throw new Error("ACK_ROTATION_BINDINGS_INVALID"); }
}

/** Configuration only: no token reads, creation, provider writes or new worker. */
export function createOperationalAckRotationCapability(environment: Environment = process.env) {
  if (environment.ACK_ROTATION_ENABLED === undefined || environment.ACK_ROTATION_ENABLED === "false") return null;
  if (environment.ACK_ROTATION_ENABLED !== "true") throw new Error("ACK_ROTATION_CAPABILITY_INVALID");
  registry(environment);
  return createOperationalAckRotationExecutor({ environment, resolveNextTokenRef: (scope) => {
    const ref = registry(environment).get(JSON.stringify([scope.organizationId,scope.projectId]));
    if (!ref) throw new Error("ACK_ROTATION_BINDING_REQUIRED"); return ref;
  } });
}
