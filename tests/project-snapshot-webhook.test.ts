import { describe, expect, it } from "vitest";
import { createProjectSnapshotWebhookResolver } from "../src/modules/snapshot-delivery/infrastructure/project-snapshot-webhook.ts";
import { createSnapshotWebhookCapability } from "../src/infrastructure/snapshot-webhook-capability.ts";

const scope = { organizationId: "org", projectId: "project" };
const binding = { ...scope, endpointRef: "SYNTHETIC_WEBHOOK_ENDPOINT" };
describe("server-owned project webhook capability", () => {
  it("stays disabled by default without resolving refs or starting HTTP", () => {
    expect(createSnapshotWebhookCapability({})).toBeNull();
    expect(createSnapshotWebhookCapability({ SNAPSHOT_WEBHOOK_ENABLED: "false", PROJECT_SNAPSHOT_WEBHOOK_BINDINGS: "bad" })).toBeNull();
    expect(() => createSnapshotWebhookCapability({ SNAPSHOT_WEBHOOK_ENABLED: "yes" })).toThrow("SNAPSHOT_WEBHOOK_CAPABILITY_INVALID");
  });
  it("resolves only exact project scope and rereads the value-free registry", () => {
    const environment = { PROJECT_SNAPSHOT_WEBHOOK_BINDINGS: JSON.stringify([binding]), SYNTHETIC_WEBHOOK_ENDPOINT: "https://consumer.example.test/hint" };
    const resolve = createProjectSnapshotWebhookResolver(environment);
    expect(resolve(scope)?.href).toBe(environment.SYNTHETIC_WEBHOOK_ENDPOINT);
    expect(resolve({ ...scope, projectId: "foreign" })).toBeNull();
    environment.PROJECT_SNAPSHOT_WEBHOOK_BINDINGS = "[]";
    expect(resolve(scope)).toBeNull();
  });
  it.each(["http://consumer.example/hint", "https://user:pass@consumer.example/hint", "https://consumer.example/hint?token=x", "https://consumer.example/hint#private"])("denies credential/query/fragment/protocol URL %s without network", (endpoint) => {
    expect(() => createProjectSnapshotWebhookResolver({ PROJECT_SNAPSHOT_WEBHOOK_BINDINGS: JSON.stringify([binding]), SYNTHETIC_WEBHOOK_ENDPOINT: endpoint })(scope))
      .toThrow("PROJECT_SNAPSHOT_WEBHOOK_CONFIGURATION_INVALID");
  });
  it.each([{ rows: [binding, binding] }, { rows: [{ ...binding, projectId: "*" }] }, { rows: [{ ...binding, endpoint: "https://caller.example" }] }])("rejects duplicate/invalid/caller URL registry", ({ rows }) => {
    expect(() => createProjectSnapshotWebhookResolver({ PROJECT_SNAPSHOT_WEBHOOK_BINDINGS: JSON.stringify(rows) })).toThrow("PROJECT_SNAPSHOT_WEBHOOK_BINDINGS_INVALID");
  });
});
