import "server-only";
import { z } from "zod";
import { defineSecretRef, resolveSecretRef } from "../../../platform/security/secret-ref.ts";

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u);
const scopeSchema = z.object({ organizationId: id, projectId: id }).strict();
const bindingSchema = scopeSchema.extend({ endpointRef: z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/u) }).strict();
type Environment = Readonly<Record<string, string | undefined>>;
function registry(environment: Environment) {
  try {
    const raw = environment.PROJECT_SNAPSHOT_WEBHOOK_BINDINGS ?? "[]";
    if (Buffer.byteLength(raw) > 128 * 1024) throw new Error();
    const rows = z.array(bindingSchema).max(256).parse(JSON.parse(raw));
    const indexed = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      const key = `${row.organizationId}/${row.projectId}`;
      if (indexed.has(key)) throw new Error();
      indexed.set(key, row);
    }
    return indexed;
  } catch { throw new Error("PROJECT_SNAPSHOT_WEBHOOK_BINDINGS_INVALID"); }
}
/** Exact server-owned registry, no payload URLs. Unconfigured projects defer. */
export function createProjectSnapshotWebhookResolver(environment: Environment = process.env) {
  registry(environment);
  return (rawScope: z.infer<typeof scopeSchema>): URL | null => {
    const scope = scopeSchema.parse(rawScope);
    const binding = registry(environment).get(`${scope.organizationId}/${scope.projectId}`);
    if (!binding) return null;
    try {
      const endpoint = resolveSecretRef(defineSecretRef(binding.endpointRef), environment);
      if (endpoint.length > 2000) throw new Error();
      const url = new URL(endpoint);
      if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error();
      return url;
    } catch { throw new Error("PROJECT_SNAPSHOT_WEBHOOK_CONFIGURATION_INVALID"); }
  };
}
