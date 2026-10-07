import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import type { S3Client } from "@aws-sdk/client-s3";
const gateway = vi.hoisted(() => vi.fn());
const matchingRuntime = vi.hoisted(() => ({ cuts: 0 }));
// defineCommand captures its runner at module construction, before later spies.
vi.mock("../../src/platform/database/transaction.ts", async (original) => {
  const actual = await original<typeof import("../../src/platform/database/transaction.ts")>();
  const run: typeof actual.runInPrincipalDatabaseTransaction = (principal, execute) => actual.runInPrincipalDatabaseTransaction(principal, async (tx) => {
    if (principal.kind === "project-job" && principal.jobName === "agent-matching") {
      await tx.$executeRawUnsafe("SET LOCAL ROLE ams_data_hub_worker");
      expect(await tx.$queryRawUnsafe("SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user"))
        .toEqual([{ rolbypassrls: false, rolsuper: false }]); matchingRuntime.cuts++;
    }
    return execute(tx);
  });
  return { ...actual, runInPrincipalDatabaseTransaction: run };
});
vi.mock("../../src/platform/http/safe-outbound.ts", async (original) => {
  const actual = await original<typeof import("../../src/platform/http/safe-outbound.ts")>();
  return { ...actual, safeOutboundStream: gateway };
});
import { createSourceExecutionServer, inventoryIdentityCommands, sourceRegistryCommands } from "../../src/modules/ingestion-core/server.ts";
import { S3ObjectStorage } from "../../src/platform/storage/timeweb-s3-object-storage.ts";
import { runInPrincipalDatabaseTransaction } from "../../src/platform/database/transaction.ts";
import * as transactionRuntime from "../../src/platform/database/transaction.ts";
import type { DatabaseTransaction } from "../../src/platform/database/transaction.ts";
import type { PlatformAdminPrincipal, PrincipalContext, ProjectJobPrincipal } from "../../src/platform/authorization/principal.ts";
import { BOOTSTRAP_SOURCE_SAFETY_POLICY, type SourceSafetyPolicy } from "../../src/modules/ingestion-core/domain/safety-engine.ts";
import { PrismaSourceExecutionRepository } from "../../src/modules/ingestion-core/infrastructure/prisma-source-execution-repository.ts";
import { enqueueSourceGoodSnapshot } from "../../src/modules/ingestion-core/infrastructure/source-snapshot-intent.ts";
import { PrismaReliabilityRepository } from "../../src/modules/platform-operations/server.ts";
import { drainOutbox } from "../../src/modules/platform-operations/worker.ts";
import { getPrismaPool } from "../../src/platform/database/prisma/client.ts";
import { sourceExecutionGuardKey } from "../../src/modules/ingestion-core/infrastructure/source-execution-guard.ts";
import { captureSnapshotInput, createSnapshotCandidateAssemblyServer } from "../../src/modules/snapshot-delivery/server.ts";
import { createProjectJobPrincipal } from "../../src/platform/authorization/principal-factories.ts";
import { publicInventoryDtoSchema } from "@ams-data-hub/realty-contracts";
import { createMediaKey } from "../../src/platform/storage/object-storage.ts";
import { feedAgentMatchingCommands } from "../../src/modules/project-state/server.ts";
import { extractVladisAgentEvidence, type YrlRawOffer } from "../../src/modules/ingestion-core/index.ts";

const namespace = "http://webmaster.yandex.ru/schemas/feed/realty/2010-06";
const offer = (id: string, price = 1000) => `<offer internal-id="${id}"><category>квартира</category><type>продажа</type><price><value>${price}</value></price><location><address>Синтетический город</address></location></offer>`;
const feed = (...offers: string[]) => `<realty-feed xmlns="${namespace}">${offers.join("")}</realty-feed>`;

async function setup(profileKey = "default-v1", policyOverride?: SourceSafetyPolicy, adapterKey = "yrl-realty-2010") {
  const principal: PlatformAdminPrincipal = { kind: "platform-admin", userId: "synthetic-runtime-admin", correlationId: randomUUID() };
  const suffix = randomUUID().slice(0, 8);
  const scope = await runInPrincipalDatabaseTransaction(principal, async (tx) => {
    const organization = await tx.organization.create({ data: { name: "Synthetic runtime", slug: `runtime-${suffix}` } });
    const project = await tx.project.create({ data: { organizationId: organization.id, name: "Synthetic runtime", slug: `runtime-${suffix}` } });
    await tx.dataSafetyState.upsert({ where: { id: "global" }, create: { id: "global", jobsFrozen: false, unfrozenAt: new Date() }, update: { jobsFrozen: false, unfrozenAt: new Date() } });
    return { organizationId: organization.id, projectId: project.id };
  });
  const referenceName = `SYNTHETIC_RUNTIME_${suffix.toUpperCase()}`;
  process.env[referenceName] = "https://synthetic.example.test/private.xml?token=synthetic-runtime-only";
  // Small normalization fixtures use an explicit project-owned test policy,
  // not the producer's calibrated 777-record live-feed threshold.
  const safetyPolicyId = profileKey === "default-v1" && !policyOverride ? "" : (await runInPrincipalDatabaseTransaction(principal,
    (tx) => tx.sourceSafetyPolicy.create({ data: { ...scope, policy: policyOverride ?? BOOTSTRAP_SOURCE_SAFETY_POLICY } }))).id;
  const source = await sourceRegistryCommands.createSource(principal, { ...scope,
    sourceKey: "synthetic", name: "Synthetic", endpointCredentialRef: referenceName,
    adapterKey, adapterVersion: "1.0.0", profileKey, profileVersion: "1.0.0",
    datasetType: "MIXED_REALTY", transportType: "HTTPS_XML", sharingPolicy: "PROJECT_ONLY", schedulePolicy: { mode: "MANUAL_ONLY" },
    safetyPolicyId, expectedNamespace: "", expectedProducer: "",
  });
  await sourceRegistryCommands.setSourceEnabled(principal, { ...scope, sourceId: source.sourceId, version: source.version, enabled: true });
  let uploaded = 0;
  const client = { send: async (command: { input: { Body: AsyncIterable<Uint8Array> } }, options?: { abortSignal?: AbortSignal }) => {
    void options;
    for await (const chunk of command.input.Body) uploaded += chunk.byteLength;
    return {};
  } };
  const storage = new S3ObjectStorage({ bucket: "synthetic-runtime", client: client as unknown as S3Client });
  const target = { ...scope, sourceId: source.sourceId };
  const runtime = createSourceExecutionServer(storage);
  const provide = (xml: string) => {
    const bytes = new TextEncoder().encode(xml);
    gateway.mockResolvedValue({ status: 200, contentType: "application/xml", contentLength: bytes.byteLength,
      finalUrl: new URL(process.env[referenceName]!), body: (async function* () { yield bytes; })(), close: vi.fn() });
  };
  const read = () => runInPrincipalDatabaseTransaction(principal, async (tx) => ({
    source: await tx.source.findUniqueOrThrow({ where: { id: target.sourceId } }),
    revisions: await tx.sourceRevision.findMany({ where: target, orderBy: { startedAt: "asc" } }),
    identities: await tx.inventoryIdentity.findMany({ where: target, orderBy: { externalOfferId: "asc" } }),
    records: await tx.sourceRevisionRecord.findMany({ where: target }),
    events: await tx.inventoryLifecycleEvent.findMany({ where: { ...scope, inventory: { sourceId: target.sourceId } }, orderBy: { occurredAt: "asc" } }),
    intents: await tx.outboxEvent.findMany({ where: { organizationId: scope.organizationId, topic: "snapshot.build.request",
      payload: { path: ["projectId"], equals: scope.projectId } }, orderBy: { occurredAt: "asc" } }),
  }));
  return { principal, target, runtime, provide, read, client, uploaded: () => uploaded, cleanup: () => { delete process.env[referenceName]; gateway.mockReset(); } };
}

describe("concrete Source application runtime with PostgreSQL and real spool/storage adapter", () => {
  it("assembles two policy-approved Sources while broken attempts preserve their own and other GOOD contributions", async () => {
    const context = await setup("vladis-vt24-v1", { ...BOOTSTRAP_SOURCE_SAFETY_POLICY, deactivationEnabled: true });
    const scope = { organizationId: context.target.organizationId, projectId: context.target.projectId };
    const initial = await context.read();
    const credential = await runInPrincipalDatabaseTransaction(context.principal, (tx) =>
      tx.sourceCredentialRef.findUniqueOrThrow({ where: { sourceId: context.target.sourceId }, select: { endpointCredentialRefName: true } }));
    const second = await sourceRegistryCommands.createSource(context.principal, { ...scope,
      sourceKey: "synthetic-second", name: "Synthetic second", endpointCredentialRef: credential.endpointCredentialRefName,
      adapterKey: "yrl-realty-2010", adapterVersion: "1.0.0", profileKey: "vladis-vt24-v1", profileVersion: "1.0.0",
      datasetType: "MIXED_REALTY", transportType: "HTTPS_XML", sharingPolicy: "PROJECT_ONLY", schedulePolicy: { mode: "MANUAL_ONLY" },
      safetyPolicyId: initial.source.safetyPolicyId!, expectedNamespace: "", expectedProducer: "",
    });
    await sourceRegistryCommands.setSourceEnabled(context.principal, { ...scope, sourceId: second.sourceId, version: second.version, enabled: true });
    await runInPrincipalDatabaseTransaction(context.principal, (tx) => tx.projectCatalogSubscription.create({ data: {
      ...scope, mode: "CURATED", cities: { create: { cityUid: "01M41T6Q04BADHXSERJHZFXKCH" } },
    } }));
    const original = transactionRuntime.runInAuthorizedDatabaseTransaction;
    const originalPrincipal = transactionRuntime.runInPrincipalDatabaseTransaction;
    let sourceWorkerCuts = 0;
    const principalRole = vi.spyOn(transactionRuntime, "runInPrincipalDatabaseTransaction").mockImplementation((principal, execute) =>
      originalPrincipal(principal, async (tx) => {
        if (principal.kind === "project-job") {
          await tx.$executeRawUnsafe("SET LOCAL ROLE ams_data_hub_worker");
          expect(await tx.$queryRawUnsafe("SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user"))
            .toEqual([{ rolbypassrls: false, rolsuper: false }]); sourceWorkerCuts++;
        }
        return execute(tx);
      }));
    let workerCuts = 0;
    const role = vi.spyOn(transactionRuntime, "runInAuthorizedDatabaseTransaction").mockImplementation((authorization, execute, options) =>
      original(authorization, async (tx) => {
        if (authorization.principalKind === "project-job") {
          await tx.$executeRawUnsafe("SET LOCAL ROLE ams_data_hub_worker");
          expect(await tx.$queryRawUnsafe("SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user"))
            .toEqual([{ rolbypassrls: false, rolsuper: false }]); workerCuts++;
        }
        return execute(tx);
      }, options));
    try {
      const aOffers = ["one", "two", "three", "four", "grace"];
      context.provide(feed(...aOffers.map((externalId) => offer(externalId))));
      expect(await context.runtime.run(context.target)).toMatchObject({ state: "GOOD", sequence: 1 });
      const secondTarget = { ...scope, sourceId: second.sourceId };
      context.provide(feed(offer("one")));
      expect(await context.runtime.run(secondTarget)).toMatchObject({ state: "GOOD", sequence: 1 });
      const identities = await runInPrincipalDatabaseTransaction(context.principal, async (tx) => {
        const rows = await tx.inventoryIdentity.findMany({ where: scope, orderBy: { uid: "asc" } });
        for (const [index, row] of rows.entries()) {
          const reservation = await tx.publicUrlIdReservation.create({ data: { ...scope, subjectType: "INVENTORY",
            subjectUid: row.uid, publicUrlId: `7${String(index).padStart(15, "0")}` } });
          await tx.projectUrlEntry.create({ data: { ...scope, entityType: "INVENTORY", entityUid: row.uid, reservationId: reservation.id,
            slug: `synthetic-${index}`, canonicalPath: `/inventory/synthetic-${index}` } });
        }
        return rows;
      });
      expect(identities).toHaveLength(6);
      expect(new Set(identities.filter((row) => row.externalOfferId === "one").map((row) => row.uid)).size).toBe(2);
      const principal = createProjectJobPrincipal({ ...scope, jobName: "snapshot-input" });
      const head = vi.fn(); const assemble = createSnapshotCandidateAssemblyServer({ ...scope, storage: { head } });
      const capture = (key: string) => captureSnapshotInput(principal, { ...scope, idempotencyKey: key, schemaMinor: 0 });
      const lookup = (receipt: Awaited<ReturnType<typeof capture>>) => ({ idempotencyKeyHash: receipt.idempotencyKeyHash, requestHash: receipt.requestHash });
      const firstReceipt = await capture("two-source-first"); const first = await assemble(principal, lookup(firstReceipt));
      context.provide(feed(...aOffers.slice(0, 4).map((externalId) => offer(externalId))));
      expect(await context.runtime.run(context.target)).toMatchObject({ state: "GOOD", sequence: 2 });
      const beforeBroken = await context.read();
      const stableReceipt = await capture("two-source-stable-a"); const stable = await assemble(principal, lookup(stableReceipt));
      for (const [xml, expected] of [["<realty-feed>", "FAILED"], [feed(offer("one")), "SUSPICIOUS"], [feed(), "REJECTED"]] as const) {
        context.provide(xml); expect((await context.runtime.run(context.target)).state).toBe("FAILED");
        const unchanged = await context.read();
        expect(unchanged.revisions.at(-1)!.status).toBe(expected);
        expect(unchanged.source.lastGoodRevisionId).toBe(beforeBroken.source.lastGoodRevisionId);
        expect(unchanged.identities).toEqual(beforeBroken.identities); expect(unchanged.events).toEqual(beforeBroken.events);
      }
      context.provide(feed(offer("one", 2000)));
      expect(await context.runtime.run(secondTarget)).toMatchObject({ state: "GOOD", sequence: 2 });
      const nextReceipt = await capture("two-source-next"); const next = await assemble(principal, lookup(nextReceipt));
      const inventory = (result: typeof first) => result.datasets.find((dataset) => dataset.kind === "inventory")!.records;
      expect(first.datasets).toHaveLength(13); expect(next.datasets).toHaveLength(13); expect(inventory(next)).toHaveLength(6);
      for (const result of [stable, next]) expect(inventory(result).map((record) => record.key).sort())
        .toEqual(identities.map((identity) => identity.uid).sort());
      for (const row of identities.filter((identity) => identity.sourceId === context.target.sourceId)) {
        expect(inventory(next).find((record) => record.key === row.uid)).toEqual(inventory(stable).find((record) => record.key === row.uid));
      }
      const bUid = identities.find((identity) => identity.sourceId === second.sourceId)!.uid;
      expect(inventory(next).find((record) => record.key === bUid)!.value).toMatchObject({ price: 2000 });
      const graceUid = identities.find((identity) => identity.externalOfferId === "grace")!.uid;
      expect(nextReceipt.parts.filter((part) => part.kind === "inventory").flatMap((part) => part.payload))
        .toContainEqual(expect.objectContaining({ uid: graceUid, factRevisionSequence: 1, approvedHeadSequence: 2, missingGoodRuns: 1 }));
      await runInPrincipalDatabaseTransaction(context.principal, async (tx) => {
        await tx.source.updateMany({ where: scope, data: { enabled: false, version: { increment: 1 } } });
        await tx.projectCatalogSubscription.delete({ where: { organizationId_projectId: scope } });
      });
      expect(await assemble(principal, lookup(firstReceipt))).toEqual(first);
      expect(await assemble(principal, lookup(nextReceipt))).toEqual(next);
      await expect(assemble(createProjectJobPrincipal({ ...scope, projectId: "synthetic-foreign", jobName: "snapshot-input" }),
        lookup(nextReceipt))).rejects.toThrow("SNAPSHOT_INPUT_ACCESS_DENIED");
      expect(head).not.toHaveBeenCalled(); expect(workerCuts).toBeGreaterThan(10); expect(sourceWorkerCuts).toBeGreaterThan(10);
    } finally { role.mockRestore(); principalRole.mockRestore(); context.cleanup(); }
  }, 60_000);

  it("captures a real confirmed GOOD agent binding, gates personal data and preserves immutable replay", async () => {
    matchingRuntime.cuts = 0;
    const context = await setup("vladis-vt24-v1", { ...BOOTSTRAP_SOURCE_SAFETY_POLICY, deactivationEnabled: true });
    const scope = { organizationId: context.target.organizationId, projectId: context.target.projectId };
    const originalPrincipal = transactionRuntime.runInPrincipalDatabaseTransaction;
    const originalAuthorized = transactionRuntime.runInAuthorizedDatabaseTransaction;
    let workerCuts = 0;
    async function lower(tx: DatabaseTransaction) {
      await tx.$executeRawUnsafe("SET LOCAL ROLE ams_data_hub_worker");
      expect(await tx.$queryRawUnsafe("SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user"))
        .toEqual([{ rolbypassrls: false, rolsuper: false }]); workerCuts++;
    }
    const sourceRole = vi.spyOn(transactionRuntime, "runInPrincipalDatabaseTransaction").mockImplementation((principal, execute) =>
      originalPrincipal(principal, async (tx) => { if (principal.kind === "project-job") await lower(tx); return execute(tx); }));
    const snapshotRole = vi.spyOn(transactionRuntime, "runInAuthorizedDatabaseTransaction").mockImplementation((principal, execute, options) =>
      originalAuthorized(principal, async (tx) => { if (principal.principalKind === "project-job") await lower(tx); return execute(tx); }, options));
    try {
      context.provide(feed(offer("one").replace("</offer>",
        "<sales-agent><name>Синтетический Агент</name><phone>+79590000001</phone></sales-agent></offer>"),
      ...["z2", "z3", "z4", "z5"].map((externalId) => offer(externalId))));
      expect(await context.runtime.run(context.target)).toMatchObject({ state: "GOOD", sequence: 1 });
      const state = await context.read(); const identity = state.identities[0]!; const revision = state.revisions[0]!;
      const record = state.records.find((row) => row.inventoryUid === identity.uid)!;
      const raw = (record.payload as unknown as { rawRecord: YrlRawOffer["element"] }).rawRecord;
      const extracted = extractVladisAgentEvidence({ line: 0, column: 0, element: raw })!;
      expect(extracted).toMatchObject({ fullNameRaw: "Синтетический Агент", offerExternalId: "one" });
      const { offerExternalId, ...evidence } = extracted;
      const matchingJob = createProjectJobPrincipal({ ...scope, jobName: "agent-matching" });
      const request = { ...scope, sourceId: context.target.sourceId, sourceRevisionId: revision.id,
        observedAt: new Date().toISOString(), evidence: [{ ...evidence, offerExternalIds: [offerExternalId] }] };
      await expect(feedAgentMatchingCommands.reconcileFeedAgents(matchingJob, { ...request,
        evidence: [{ ...evidence, offerExternalIds: Array.from({ length: 50_000 }, () => offerExternalId) }] }))
        .rejects.toThrow("AGENT_MATCHING_LIMIT_EXCEEDED");
      await expect(feedAgentMatchingCommands.reconcileFeedAgents(matchingJob, { ...request, sourceRevisionId: "missing-good" }))
        .rejects.toThrow("AGENT_MATCHING_GOOD_FACT_INVALID");
      const foreignJob = createProjectJobPrincipal({ ...scope, projectId: "synthetic-foreign", jobName: "agent-matching" });
      await expect(feedAgentMatchingCommands.reconcileFeedAgents(foreignJob, request))
        .rejects.toThrow("AGENT_MATCHING_PROJECT_JOB_REQUIRED");
      const matched = await feedAgentMatchingCommands.reconcileFeedAgents(matchingJob, request);
      const agentUid = matched.bindings[0]!.agentUid!; expect(agentUid).toBeTruthy();
      expect((await feedAgentMatchingCommands.reconcileFeedAgents(matchingJob, request)).bindings[0]!.agentUid).toBe(agentUid);
      expect(await runInPrincipalDatabaseTransaction(foreignJob, (tx) => tx.listingAgentBinding.findMany({ where: scope }))).toEqual([]);
      // A second unresolved claim vetoes the durable assignment; full replay restores it.
      await feedAgentMatchingCommands.reconcileFeedAgents(matchingJob, { ...request,
        evidence: [...request.evidence, { fullNameRaw: "Синтетический Неподтвержденный", phoneRaw: "invalid",
          offerExternalIds: [offerExternalId] }] });
      expect(await runInPrincipalDatabaseTransaction(matchingJob, (tx) => tx.listingAgentBinding.findMany({ where: scope }))).toEqual([]);
      await feedAgentMatchingCommands.reconcileFeedAgents(matchingJob, request);
      await expect(runInPrincipalDatabaseTransaction(matchingJob, (tx) => tx.listingAgentBinding.create({ data: {
        ...scope, sourceId: context.target.sourceId, sourceRevisionId: revision.id, inventoryUid: identity.uid,
        recordHash: "f".repeat(64), agentUid } }))).rejects.toThrow("LISTING_AGENT_FACT_INVALID");
      await runInPrincipalDatabaseTransaction(context.principal, async (tx) => {
        expect(await tx.listingAgentBinding.findMany({ where: scope })).toEqual([expect.objectContaining({
          inventoryUid: identity.uid, sourceRevisionId: revision.id, recordHash: record.recordHash, agentUid })]);
        await tx.projectCatalogSubscription.create({ data: { ...scope, mode: "CURATED", cities: { create: { cityUid: "01M41T6Q04BADHXSERJHZFXKCH" } } } });
        await tx.projectPublicContact.create({ data: { ...scope, phone: "+70000000077", messengers: [] } });
        for (const [index, listing] of state.identities.entries()) {
          const reservation = await tx.publicUrlIdReservation.create({ data: { ...scope, subjectType: "INVENTORY",
            subjectUid: listing.uid, publicUrlId: `123456789012345${index}` } });
          await tx.projectUrlEntry.create({ data: { ...scope, entityType: "INVENTORY", entityUid: listing.uid,
            reservationId: reservation.id, slug: `synthetic-gated-${index}`, canonicalPath: `/inventory/synthetic-gated-${index}` } });
        }
        const asset = await tx.mediaAsset.create({ data: { ...scope, sha256: "a".repeat(64),
          storageKey: createMediaKey("a".repeat(64)), contentType: "image/jpeg", byteSize: 100,
          originalFileName: "synthetic-private.jpg", source: "https://private.example.invalid/synthetic-photo",
          rightsBasis: "LICENSED", license: "synthetic-license",
          uploadedBy: "synthetic-admin" } });
        await tx.agent.update({ where: { uid: agentUid }, data: { photoMediaId: asset.id } });
      });
      const principal = createProjectJobPrincipal({ ...scope, jobName: "snapshot-input" });
      expect(await runInPrincipalDatabaseTransaction(principal, (tx) => tx.listingAgentBinding.deleteMany({ where: scope })))
        .toMatchObject({ count: 0 });
      const head = vi.fn(async (key: string) => ({ key, sha256: "a".repeat(64), contentType: "image/jpeg",
        contentLength: 100, etag: null, lastModifiedAt: new Date(0) }));
      const assemble = createSnapshotCandidateAssemblyServer({ ...scope, storage: { head } });
      async function build(key: string) {
        const receipt = await captureSnapshotInput(principal, { ...scope, idempotencyKey: key, schemaMinor: 0 });
        const lookup = { idempotencyKeyHash: receipt.idempotencyKeyHash, requestHash: receipt.requestHash };
        return { result: await assemble(principal, lookup), lookup };
      }
      function assertOmitted(result: Awaited<ReturnType<typeof assemble>>) {
        expect(result.datasets.find((row) => row.kind === "agents")!.records).toEqual([]);
        const listing = result.datasets.find((row) => row.kind === "inventory")!.records.find((row) => row.key === identity.uid)!;
        expect(listing.value).toMatchObject({ uid: identity.uid });
        expect(listing.value).not.toHaveProperty("agentUid");
        expect(result.datasets.find((row) => row.kind === "media")!.records.filter((row) => row.key.startsWith("AGENT/"))).toEqual([]);
        expect(result.datasets.find((row) => row.kind === "project/contacts")!.records[0]!.value).toMatchObject({ phone: "+70000000077" });
      }
      assertOmitted((await build("agent-no-consent")).result);
      expect(head).not.toHaveBeenCalled();
      await runInPrincipalDatabaseTransaction(context.principal, (tx) => tx.agent.update({ where: { uid: agentUid },
        data: { showOnSite: true, consentConfirmedAt: new Date(), consentConfirmedBy: "synthetic-admin", consentBasis: "synthetic" } }));
      const eligible = await build("agent-eligible");
      expect(eligible.result.datasets.find((row) => row.kind === "agents")!.records).toHaveLength(1);
      expect(eligible.result.datasets.find((row) => row.kind === "media")!.records.map((row) => row.key)).toContain(`AGENT/${agentUid}/0`);
      expect(eligible.result.datasets.find((row) => row.kind === "inventory")!.records.find((row) => row.key === identity.uid)).toMatchObject({
        value: { uid: identity.uid, agentUid }, references: expect.arrayContaining([{ kind: "agents", key: agentUid }]) });
      // One missing GOOD run retains the listing and its exact historical assignment.
      context.provide(feed(...["z2", "z3", "z4", "z5"].map((externalId) => offer(externalId))));
      expect(await context.runtime.run(context.target)).toMatchObject({ state: "GOOD", sequence: 2 });
      const grace = await build("agent-historical-grace");
      expect(grace.result.datasets.find((row) => row.kind === "inventory")!.records.find((row) => row.key === identity.uid))
        .toMatchObject({ value: { uid: identity.uid, agentUid } });
      context.provide(feed()); expect((await context.runtime.run(context.target)).state).toBe("FAILED");
      const rejected = (await context.read()).revisions.at(-1)!; expect(rejected.status).toBe("REJECTED");
      await expect(feedAgentMatchingCommands.reconcileFeedAgents(matchingJob, { ...request, sourceRevisionId: rejected.id }))
        .rejects.toThrow("AGENT_MATCHING_GOOD_FACT_INVALID");
      for (const [index, patch] of [{ status: "HIDDEN" as const }, { status: "DEPARTED" as const },
        { status: "ACTIVE" as const, showOnSite: false }, { status: "ACTIVE" as const, showOnSite: true, consentConfirmedAt: null }].entries()) {
        await runInPrincipalDatabaseTransaction(context.principal, (tx) => tx.agent.update({ where: { uid: agentUid }, data: patch }));
        const beforeHeads = head.mock.calls.length;
        assertOmitted((await build(`agent-gated-${index}`)).result);
        expect(head.mock.calls).toHaveLength(beforeHeads);
      }
      expect(await assemble(principal, eligible.lookup)).toEqual(eligible.result);
      await runInPrincipalDatabaseTransaction(context.principal, (tx) => tx.dataSafetyState.update({ where: { id: "global" }, data: { jobsFrozen: true } }));
      await expect(feedAgentMatchingCommands.reconcileFeedAgents(matchingJob, request)).rejects.toThrow("DATA_SAFETY_JOBS_FROZEN");
      expect(workerCuts).toBeGreaterThan(10);
      expect(matchingRuntime.cuts).toBeGreaterThan(2);
    } finally {
      sourceRole.mockRestore(); snapshotRole.mockRestore();
      await runInPrincipalDatabaseTransaction(context.principal, (tx) => tx.dataSafetyState.update({ where: { id: "global" }, data: { jobsFrozen: false } }));
      context.cleanup();
    }
  }, 60_000);

  it.each([
    ["yrl-realty-2010", "vladis-vt24-v1", "YRL"],
    ["yrl-realty-2010", "joywork-domclick-v1", "YRL"],
    ["avito-xml-v3", "joywork-avito-v3", "AVITO"],
    ["cian-xml-v2", "joywork-cian-v2", "CIAN"],
  ])("assembles only PublicInventoryDTO from actual %s / %s GOOD with private sentinels", async (adapter, profile, family) => {
    const context = await setup(profile, undefined, adapter);
    const scope = { organizationId: context.target.organizationId, projectId: context.target.projectId };
    const address = "Синтетический город, дом 9, кв. 424242";
    const description = "Код объекта: PRIVATE-DTO-CODE. Публичный текст";
    const image = "https://private.example.invalid/PRIVATE-DTO-IMAGE.jpg";
    const xml = family === "YRL" ? feed(`<offer internal-id="PRIVATE-DTO-ID"><category>квартира</category><type>продажа</type>
      <price><value>1000</value></price><location><address>${address}</address><apartment>424242</apartment>
      <latitude>55.751234</latitude><longitude>37.612345</longitude></location><description>${description}</description>
      <sales-agent><phone>+70000000001</phone></sales-agent><picture>${image}</picture><private-test>PRIVATE-DTO-RAW</private-test></offer>`)
      : family === "AVITO" ? `<Ads formatVersion="3" target="Avito.ru"><Ad><Id>PRIVATE-DTO-ID</Id><Category>Квартиры</Category>
        <OperationType>Продам</OperationType><Price>1000</Price><Address>${address}</Address><Latitude>55.751234</Latitude>
        <Longitude>37.612345</Longitude><Description>${description}</Description><ContactPhone>+70000000001</ContactPhone>
        <Images><Image url="${image}"/></Images><PrivateTest>PRIVATE-DTO-RAW</PrivateTest></Ad></Ads>`
        : `<Feed><Feed_Version>2</Feed_Version><Object><ExternalId>PRIVATE-DTO-ID</ExternalId><Category>flatSale</Category>
          <Price>1000</Price><Address>${address}</Address><Coordinates><Lat>55.751234</Lat><Lng>37.612345</Lng></Coordinates>
          <Description>${description}</Description><Phones><PhoneSchema><Number>+70000000001</Number></PhoneSchema></Phones>
          <Photos><PhotoSchema><FullUrl>${image}</FullUrl></PhotoSchema></Photos><PrivateTest>PRIVATE-DTO-RAW</PrivateTest></Object></Feed>`;
    const originalPrincipal = transactionRuntime.runInPrincipalDatabaseTransaction;
    const originalAuthorized = transactionRuntime.runInAuthorizedDatabaseTransaction;
    let sourceCuts = 0; let snapshotCuts = 0;
    async function lower(tx: DatabaseTransaction) {
      await tx.$executeRawUnsafe("SET LOCAL ROLE ams_data_hub_worker");
      expect(await tx.$queryRawUnsafe("SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user"))
        .toEqual([{ rolbypassrls: false, rolsuper: false }]);
    }
    const sourceRole = vi.spyOn(transactionRuntime, "runInPrincipalDatabaseTransaction").mockImplementation((principal, execute) =>
      originalPrincipal(principal, async (tx) => {
        if (principal.kind === "project-job") { await lower(tx); sourceCuts++; }
        return execute(tx);
      }));
    const snapshotRole = vi.spyOn(transactionRuntime, "runInAuthorizedDatabaseTransaction").mockImplementation((principal, execute, options) =>
      originalAuthorized(principal, async (tx) => {
        if (principal.principalKind === "project-job") { await lower(tx); snapshotCuts++; }
        return execute(tx);
      }, options));
    try {
      context.provide(xml);
      expect(await context.runtime.run(context.target)).toMatchObject({ state: "GOOD", sequence: 1 });
      const state = await context.read(); const identity = state.identities[0]!;
      expect(JSON.stringify(state.records[0]!.payload)).toContain("PRIVATE-DTO-RAW");
      expect(JSON.stringify(state.records[0]!.payload)).toContain("+70000000001");
      expect(state.records[0]!.payload).toMatchObject({ draft: { latitude: 55.751234, longitude: 37.612345 } });
      await runInPrincipalDatabaseTransaction(context.principal, async (tx) => {
        await tx.projectCatalogSubscription.create({ data: { ...scope, mode: "CURATED",
          cities: { create: { cityUid: "01M41T6Q04BADHXSERJHZFXKCH" } } } });
        const reservation = await tx.publicUrlIdReservation.create({ data: { ...scope, subjectType: "INVENTORY",
          subjectUid: identity.uid, publicUrlId: "1234567890123456" } });
        await tx.projectUrlEntry.create({ data: { ...scope, entityType: "INVENTORY", entityUid: identity.uid,
          reservationId: reservation.id, slug: "synthetic-dto", canonicalPath: "/inventory/synthetic-dto" } });
      });
      const principal = createProjectJobPrincipal({ ...scope, jobName: "snapshot-input" });
      const receipt = await captureSnapshotInput(principal, { ...scope, idempotencyKey: "synthetic-dto", schemaMinor: 0 });
      const head = vi.fn(); const assemble = createSnapshotCandidateAssemblyServer({ ...scope, storage: { head } });
      const lookup = { idempotencyKeyHash: receipt.idempotencyKeyHash, requestHash: receipt.requestHash };
      const result = await assemble(principal, lookup);
      expect(result.datasets).toHaveLength(13);
      const inventory = result.datasets.find((dataset) => dataset.kind === "inventory")!.records;
      expect(inventory).toHaveLength(1);
      const dto = publicInventoryDtoSchema.parse(inventory[0]!.value);
      expect(dto).toEqual(inventory[0]!.value);
      expect(dto).toMatchObject({ uid: identity.uid, publicUrlId: "1234567890123456", locationPrecision: "STREET",
        descriptionText: "Публичный текст", media: [] });
      expect(dto.address.addressPublic).not.toContain("424242");
      expect(dto.geo).toMatchObject({ latitude: { state: "VALUE", value: expect.any(Number) },
        longitude: { state: "VALUE", value: expect.any(Number) } });
      if (dto.geo.latitude.state !== "VALUE" || dto.geo.longitude.state !== "VALUE") throw new Error("SYNTHETIC_PUBLIC_GEO_MISSING");
      expect(Number.isFinite(dto.geo.latitude.value) && Number.isFinite(dto.geo.longitude.value)).toBe(true);
      expect(dto.geo).not.toEqual({ latitude: { state: "VALUE", value: 55.751234 }, longitude: { state: "VALUE", value: 37.612345 } });
      expect(JSON.stringify(result.datasets)).not.toMatch(/PRIVATE-DTO|424242|70000000001|rawRecord|sourceHash|normalizedHash|sourceId|safetyPolicy|factApproval/u);
      expect(head).not.toHaveBeenCalled();
      await runInPrincipalDatabaseTransaction(context.principal, (tx) => tx.source.update({ where: { id: context.target.sourceId },
        data: { enabled: false, profileKey: "default-v1", version: { increment: 1 } } }));
      expect(await assemble(principal, lookup)).toEqual(result);
      expect(sourceCuts).toBeGreaterThan(0); expect(snapshotCuts).toBeGreaterThan(0);
    } finally { sourceRole.mockRestore(); snapshotRole.mockRestore(); context.cleanup(); }
  }, 60_000);

  it.each([
    ["yrl-realty-2010", "vladis-vt24-v1", feed(offer("one")), "YRL_2010"],
    ["yrl-realty-2010", "joywork-domclick-v1", feed(offer("one")), "DOMCLICK_YRL"],
    ["avito-xml-v3", "joywork-avito-v3", '<Ads formatVersion="3" target="Avito.ru"><Ad><Id>one</Id><Category>Квартиры</Category><OperationType>Продам</OperationType><Price>1000</Price></Ad></Ads>', "AVITO_V3"],
    ["cian-xml-v2", "joywork-cian-v2", '<Feed><Feed_Version>2</Feed_Version><Object><ExternalId>one</ExternalId><Category>flatSale</Category><Price>1000</Price></Object></Feed>', "CIAN_V2"],
  ])("executes persisted %s / %s configuration through GOOD and preserves it on broken input", async (adapter, profile, xml, format) => {
    const context = await setup(profile, undefined, adapter);
    try {
      context.provide(xml);
      const first = await context.runtime.run(context.target);
      expect(first, JSON.stringify(first)).toMatchObject({ state: "GOOD", sequence: 1, snapshotTriggered: true });
      const baseline = await context.read();
      expect(baseline.records).toHaveLength(1);
      expect(baseline.records[0]!.payload).toMatchObject({ draft: {
        externalId: "one", propertyType: "APARTMENT", transactionType: "SALE", sourceFormat: format, price: 1000,
      } });
      expect(context.uploaded()).toBe(Buffer.byteLength(xml));
      context.provide(xml.replace("1000", "2000"));
      expect(await context.runtime.run(context.target)).toMatchObject({ state: "GOOD", sequence: 2 });
      const changed = await context.read();
      expect(baseline.identities[0]!.uid).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/u);
      expect(changed.identities[0]!.uid).toBe(baseline.identities[0]!.uid);
      expect(changed.records.every((record) => record.inventoryUid === baseline.identities[0]!.uid)).toBe(true);
      expect(changed.revisions.at(-1)!.normalizedContentHash).not.toBe(baseline.revisions[0]!.normalizedContentHash);
      expect(changed.intents).toHaveLength(2);
      context.provide(xml.slice(0, -8));
      expect(await context.runtime.run(context.target)).toMatchObject({ state: "FAILED", failedStage: "PARSE" });
      const broken = await context.read();
      expect(broken.source.lastGoodRevisionId).toBe(changed.source.lastGoodRevisionId);
      expect(broken.identities).toEqual(changed.identities);
      expect(broken.events).toEqual(changed.events);
      expect(broken.intents).toEqual(changed.intents);
      expect(broken.revisions.at(-1)!.status).toBe("FAILED");
    } finally { context.cleanup(); }
  });

  it("keeps snapshot intent pending while the real default outbox drain completes maintenance", async () => {
    const context = await setup();
    const workerId = `mp03-reservation-${randomUUID().slice(0, 8)}`;
    try {
      context.provide(feed(offer("one")));
      expect(await context.runtime.run(context.target)).toMatchObject({ state: "GOOD", snapshotTriggered: true });
      const baseline = await context.read();
      const now = new Date();
      const maintenance = await runInPrincipalDatabaseTransaction(context.principal, (tx) => new PrismaReliabilityRepository(tx).enqueueEvent({
        organizationId: context.target.organizationId, organizationScope: context.target.organizationId,
        idempotencyScope: "mp03.maintenance", idempotencyKey: randomUUID(), requestHash: "a".repeat(64),
        topic: "platform.maintenance.requested", payload: { operation: "synthetic-maintenance" },
        actorType: "SYSTEM", actorId: "synthetic-admin", action: "platform.maintenance.requested",
        entityType: "Project", entityId: context.target.projectId, source: "synthetic-runtime",
        correlationId: randomUUID(), schemaVersion: 1, occurredAt: now.toISOString(), availableAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + 24 * 3_600_000).toISOString(),
      }));
      await drainOutbox({ workerId, maxEvents: 25 });
      await drainOutbox({ workerId, maxEvents: 25 });
      const status = await runInPrincipalDatabaseTransaction(context.principal, (tx) => tx.outboxEvent.findUniqueOrThrow({ where: { id: maintenance.outboxEventId } }));
      expect(status.status).toBe("PROCESSED");
      expect((await context.read()).intents).toEqual(baseline.intents);
    } finally {
      await runInPrincipalDatabaseTransaction(context.principal, (tx) => tx.runtimeHeartbeat.deleteMany({ where: { workerId } }));
      context.cleanup();
    }
  });

  it("executes real GOOD and outbox writes with the non-bypass worker database role", async () => {
    const context = await setup();
    const original = transactionRuntime.runInPrincipalDatabaseTransaction;
    let checked = 0;
    const failures: string[] = [];
    async function runAsWorker<T>(principal: PrincipalContext, execute: (tx: DatabaseTransaction) => Promise<T>): Promise<T> {
      return original(principal, async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL ROLE ams_data_hub_worker");
        expect(await tx.$queryRawUnsafe('SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user')).toEqual([{ rolbypassrls: false }]);
        checked += 1;
        try { return await execute(tx); } catch (error) {
          const message = error instanceof Error ? error.message : "";
          failures.push(message.match(/permission denied for (?:table|schema) [A-Za-z0-9_]+/u)?.[0]
            ?? (error && typeof error === "object" && "code" in error ? String(error.code) : "DATABASE_EXECUTION_FAILED"));
          throw error;
        }
      });
    }
    // Keep the production facade/SQL unchanged. The test fixture login is an
    // owner for setup; explicitly lower the actual session role for execution.
    const role = vi.spyOn(transactionRuntime, "runInPrincipalDatabaseTransaction").mockImplementation(runAsWorker);
    try {
      context.provide(feed(offer("one")));
      const result = await context.runtime.run(context.target);
      expect(result, JSON.stringify({ result, failures })).toMatchObject({ state: "GOOD", snapshotTriggered: true });
      expect(checked).toBeGreaterThan(3);
      role.mockRestore();
      expect((await context.read()).intents).toHaveLength(1);
    } finally { role.mockRestore(); context.cleanup(); }
  });

  it("commits one durable idempotent value-free snapshot intent per GOOD revision", async () => {
    const context = await setup();
    try {
      context.provide(feed(offer("one")));
      const result = await context.runtime.run(context.target);
      expect(result).toMatchObject({ state: "GOOD", snapshotTriggered: true });
      if (result.state !== "GOOD") throw new Error("SYNTHETIC_GOOD_REQUIRED");
      const current = await context.read();
      expect(current.intents).toHaveLength(1);
      expect(current.intents[0]).toMatchObject({ status: "PENDING", attempts: 0,
        payload: { schemaVersion: 1, ...context.target, sourceRevisionId: result.revisionId, sourceRevisionSequence: 1 } });
      const job: ProjectJobPrincipal = { kind: "project-job", jobName: "source-import", ...context.target, correlationId: randomUUID() };
      const duplicate = await runInPrincipalDatabaseTransaction(job, (tx) => enqueueSourceGoodSnapshot(tx, job, context.target, result));
      expect(duplicate).toMatchObject({ duplicate: true, outboxEventId: current.intents[0]!.id });
      expect((await context.read()).intents).toEqual(current.intents);
      expect(JSON.stringify(current.intents)).not.toContain("synthetic.example.test");
      expect(JSON.stringify(current.intents)).not.toContain("synthetic-runtime-only");
      context.provide(feed(offer("one", 2000)));
      expect(await context.runtime.run(context.target)).toMatchObject({ state: "GOOD", sequence: 2, snapshotTriggered: true });
      expect((await context.read()).intents).toHaveLength(2);
    } finally { context.cleanup(); }
  });

  it("rolls back GOOD, identities and lifecycle when transactional outbox enqueue fails", async () => {
    const context = await setup("default-v1", { ...BOOTSTRAP_SOURCE_SAFETY_POLICY,
      deactivationEnabled: true, inactiveAfterMissingHours: 0, inactiveAfterMissingGoodRuns: 1 });
    let fault: ReturnType<typeof vi.spyOn> | undefined;
    try {
      const all = [1, 2, 3, 4, 5].map((id) => offer(String(id)));
      context.provide(feed(...all));
      expect(await context.runtime.run(context.target)).toMatchObject({ state: "GOOD" });
      const baseline = await context.read();
      fault = vi.spyOn(PrismaReliabilityRepository.prototype, "enqueueEvent").mockRejectedValueOnce(new Error("SYNTHETIC_OUTBOX_UNAVAILABLE"));
      context.provide(feed(...all.slice(0, 4)));
      expect(await context.runtime.run(context.target)).toMatchObject({ state: "FAILED", failedStage: "DATABASE_APPLY" });
      const current = await context.read();
      expect(current.source.lastGoodRevisionId).toBe(baseline.source.lastGoodRevisionId);
      expect(current.identities).toEqual(baseline.identities);
      expect(current.events).toEqual(baseline.events);
      expect(current.intents).toEqual(baseline.intents);
      expect(current.revisions.at(-1)?.status).toBe("FAILED");
    } finally { fault?.mockRestore(); context.cleanup(); }
  });

  it("rolls back identity/lifecycle/GOOD changes when the final database transaction fails", async () => {
    const context = await setup("default-v1", { ...BOOTSTRAP_SOURCE_SAFETY_POLICY,
      deactivationEnabled: true, inactiveAfterMissingHours: 0, inactiveAfterMissingGoodRuns: 1 });
    const original = PrismaSourceExecutionRepository.prototype.apply;
    let fault: ReturnType<typeof vi.spyOn> | undefined;
    try {
      const all = [1, 2, 3, 4, 5].map((id) => offer(String(id)));
      context.provide(feed(...all));
      expect(await context.runtime.run(context.target)).toMatchObject({ state: "GOOD" });
      const baseline = await context.read();
      // Fault injection is only a negative DB-commit boundary probe. The real
      // apply executes first, including identities, events and GOOD/pointer.
      fault = vi.spyOn(PrismaSourceExecutionRepository.prototype, "apply").mockImplementationOnce(async function (
        this: PrismaSourceExecutionRepository, execution, revisionId, plan,
      ) {
        await original.call(this, execution, revisionId, plan);
        throw new Error("SYNTHETIC_POST_GOOD_FAILURE");
      });
      context.provide(feed(...all.slice(0, 4)));
      expect(await context.runtime.run(context.target)).toMatchObject({ state: "FAILED", failedStage: "DATABASE_APPLY" });
      const current = await context.read();
      expect(current.source.lastGoodRevisionId).toBe(baseline.source.lastGoodRevisionId);
      expect(current.identities).toEqual(baseline.identities);
      expect(current.events).toEqual(baseline.events);
      expect(current.intents).toEqual(baseline.intents);
      expect(current.revisions.at(-1)?.status).toBe("FAILED");
    } finally { fault?.mockRestore(); context.cleanup(); }
  });

  it("blocks competing facades before intake and pins Last Good only after exclusive admission", async () => {
    const context = await setup();
    try {
      context.provide(feed(offer("one")));
      expect(await context.runtime.run(context.target)).toMatchObject({ state: "GOOD", sequence: 1 });
      let calls = 0;
      let release!: () => void;
      const barrier = new Promise<void>((resolve) => { release = resolve; });
      let started!: () => void;
      const intakeStarted = new Promise<void>((resolve) => { started = resolve; });
      gateway.mockImplementation(async () => {
        const price = ++calls * 2000;
        started();
        await barrier;
        const bytes = new TextEncoder().encode(feed(offer("one", price)));
        return { status: 200, contentType: "application/xml", contentLength: bytes.byteLength,
          body: (async function* () { yield bytes; })(), close: vi.fn() };
      });
      const first = context.runtime.run(context.target);
      await intakeStarted;
      const second = await createSourceExecutionServer(new S3ObjectStorage({ bucket: "synthetic-unused", client: {} as S3Client })).run(context.target);
      expect(second).toMatchObject({ state: "FAILED", code: "SOURCE_EXECUTION_BUSY" });
      expect(calls).toBe(1);
      expect((await context.read()).revisions).toHaveLength(2);
      release();
      const results = [await first, second];
      expect(results.map((result) => result.state).sort()).toEqual(["FAILED", "GOOD"]);
      const winner = results.find((result) => result.state === "GOOD")!;
      const current = await context.read();
      expect(winner).toMatchObject({ state: "GOOD", sequence: 2, revisionId: current.source.lastGoodRevisionId });
      expect(current.revisions.filter((revision) => revision.status === "GOOD")).toHaveLength(2);
      expect(current.identities).toHaveLength(1);
      expect(current.identities[0]!.sourceHash).toBe(winner.state === "GOOD" ? winner.rawArtifactHash : "");
      context.provide(feed(offer("one", 6000)));
      expect(await context.runtime.run(context.target)).toMatchObject({ state: "GOOD", sequence: 3 });
    } finally { context.cleanup(); }
  });

  it("rolls back an in-flight GOOD transaction on guardian death before ownership can transfer", async () => {
    const context = await setup();
    const apply = PrismaSourceExecutionRepository.prototype.apply;
    let fault: ReturnType<typeof vi.spyOn> | undefined;
    try {
      context.provide(feed(offer("one")));
      expect(await context.runtime.run(context.target)).toMatchObject({ state: "GOOD", sequence: 1 });
      const baseline = await context.read();
      fault = vi.spyOn(PrismaSourceExecutionRepository.prototype, "apply").mockImplementationOnce(async function (
        this: PrismaSourceExecutionRepository, execution, revisionId, plan, manualRequestId,
      ) {
        const result = await apply.call(this, execution, revisionId, plan, manualRequestId);
        const key = sourceExecutionGuardKey(context.target);
        const guardian = await getPrismaPool().query<{ pid: number }>(`SELECT pid FROM pg_locks
          WHERE locktype = 'advisory' AND mode = 'ShareLock' AND granted AND objsubid = 2
            AND classid::bigint = $1 AND objid::bigint = $2 AND pid <> pg_backend_pid()`, [key[0] >>> 0, key[1] >>> 0]);
        // Guardian and fenced apply both own shared locks. Kill only the idle guardian.
        const sessions = await getPrismaPool().query<{ pid: number }>("SELECT pid FROM pg_stat_activity WHERE pid = ANY($1::int[]) AND state = 'idle'", [guardian.rows.map((row) => row.pid)]);
        expect(sessions.rows).toHaveLength(1);
        expect((await getPrismaPool().query("SELECT pg_terminate_backend($1) AS killed", [sessions.rows[0]!.pid])).rows[0]?.killed).toBe(true);
        expect(await context.runtime.run(context.target)).toMatchObject({ state: "FAILED", code: "SOURCE_EXECUTION_BUSY" });
        return result;
      });
      context.provide(feed(offer("one", 2000)));
      expect(await context.runtime.run(context.target)).toMatchObject({ state: "FAILED", failedStage: "DATABASE_APPLY", code: "SOURCE_EXECUTION_LEASE_LOST" });
      fault.mockRestore();
      const lost = await context.read();
      expect(lost.source.lastGoodRevisionId).toBe(baseline.source.lastGoodRevisionId);
      expect(lost.identities).toEqual(baseline.identities); expect(lost.intents).toEqual(baseline.intents);
      context.provide(feed(offer("one", 3000)));
      expect(await context.runtime.run(context.target)).toMatchObject({ state: "GOOD", sequence: 2 });
    } finally { fault?.mockRestore(); context.cleanup(); }
  });

  it("cancels a stalled SDK upload on guardian death, cleans only its spool and permits recovery", async () => {
    const context = await setup();
    const spools = async () => (await readdir(tmpdir())).filter((name) => name.startsWith("ams-data-hub-raw-")).sort();
    const before = await spools();
    let fault: ReturnType<typeof vi.spyOn> | undefined;
    try {
      context.provide(feed(offer("one")));
      expect(await context.runtime.run(context.target)).toMatchObject({ state: "GOOD", sequence: 1 });
      const baseline = await context.read();
      let started!: () => void;
      const uploading = new Promise<void>((resolve) => { started = resolve; });
      let cancelled = false;
      fault = vi.spyOn(context.client, "send").mockImplementationOnce(async (command, options) => {
        for await (const chunk of command.input.Body) expect(chunk.byteLength).toBeGreaterThan(0);
        expect(options?.abortSignal).toBeDefined();
        started();
        return new Promise((_, reject) => {
          options!.abortSignal!.addEventListener("abort", () => { cancelled = true; reject(new Error("SYNTHETIC_UPLOAD_ABORTED")); }, { once: true });
        });
      });
      context.provide(feed(offer("one", 2000)));
      const attempt = context.runtime.run(context.target);
      await uploading;
      expect((await spools()).length).toBe(before.length + 1);
      const key = sourceExecutionGuardKey(context.target);
      const owner = await getPrismaPool().query<{ pid: number }>(`SELECT pid FROM pg_locks WHERE locktype = 'advisory'
        AND mode = 'ShareLock' AND granted AND classid::bigint = $1 AND objid::bigint = $2 AND objsubid = 2`, [key[0] >>> 0, key[1] >>> 0]);
      expect(owner.rows).toHaveLength(1);
      await getPrismaPool().query("SELECT pg_terminate_backend($1)", [owner.rows[0]!.pid]);
      expect(await attempt).toMatchObject({ state: "FAILED", code: "SOURCE_EXECUTION_LEASE_LOST" });
      expect(cancelled).toBe(true); expect(await spools()).toEqual(before);
      expect((await context.read()).source.lastGoodRevisionId).toBe(baseline.source.lastGoodRevisionId);
      expect((await context.read()).identities).toEqual(baseline.identities);
      fault.mockRestore(); context.provide(feed(offer("one", 3000)));
      expect(await context.runtime.run(context.target)).toMatchObject({ state: "GOOD", sequence: 2 });
      expect(await spools()).toEqual(before);
    } finally { fault?.mockRestore(); context.cleanup(); }
  });

  it("still rejects changed Source configuration at final apply despite lifetime serialization", async () => {
    const context = await setup();
    try {
      context.provide(feed(offer("one")));
      expect(await context.runtime.run(context.target)).toMatchObject({ state: "GOOD", sequence: 1 });
      const baseline = await context.read();
      context.provide(feed(offer("one", 2000)));
      const response = await gateway();
      gateway.mockImplementationOnce(async () => {
        await runInPrincipalDatabaseTransaction(context.principal, (tx) => tx.source.update({ where: { id: context.target.sourceId }, data: { version: { increment: 1 } } }));
        return response;
      });
      expect(await context.runtime.run(context.target)).toMatchObject({ state: "FAILED", code: "SOURCE_EXECUTION_STALE" });
      expect((await context.read()).source.lastGoodRevisionId).toBe(baseline.source.lastGoodRevisionId);
      expect((await context.read()).identities).toEqual(baseline.identities);
    } finally { context.cleanup(); }
  });

  it("advances missing grace only on safe GOOD runs and preserves inventory across broken runs", async () => {
    const context = await setup("default-v1", { ...BOOTSTRAP_SOURCE_SAFETY_POLICY,
      deactivationEnabled: true, inactiveAfterMissingHours: 0, inactiveAfterMissingGoodRuns: 2 });
    try {
      const all = [1, 2, 3, 4, 5].map((id) => offer(String(id)));
      context.provide(feed(...all));
      expect(await context.runtime.run(context.target)).toMatchObject({ state: "GOOD", sequence: 1 });
      const initial = await context.read();
      const missingUid = initial.identities.find((item) => item.externalOfferId === "5")!.uid;
      context.provide(feed(...all.slice(0, 4)));
      expect(await context.runtime.run(context.target)).toMatchObject({ state: "GOOD", sequence: 2 });
      const grace = await context.read();
      expect(grace.identities.find((item) => item.uid === missingUid)).toMatchObject({ status: "ACTIVE", missingGoodRuns: 1 });
      expect(grace.events).toHaveLength(0);
      for (const broken of ["<realty-feed>", feed(), feed(offer("1"), offer("1")), feed(offer("1")), feed(offer("1", -1))]) {
        context.provide(broken);
        expect(await context.runtime.run(context.target)).toMatchObject({ state: "FAILED" });
        const current = await context.read();
        expect(current.source.lastGoodRevisionId).toBe(grace.source.lastGoodRevisionId);
        expect(current.identities).toEqual(grace.identities);
        expect(current.events).toEqual(grace.events);
        expect(current.intents).toEqual(grace.intents);
      }
      context.provide(feed(...all.slice(0, 4)));
      expect(await context.runtime.run(context.target)).toMatchObject({ state: "GOOD", sequence: 3 });
      const inactive = await context.read();
      expect(inactive.identities).toHaveLength(5);
      expect(inactive.identities.find((item) => item.uid === missingUid)).toMatchObject({ status: "INACTIVE", missingGoodRuns: 2 });
      expect(inactive.events).toMatchObject([{ inventoryUid: missingUid, type: "INACTIVATED" }]);
      context.provide(feed(...all));
      expect(await context.runtime.run(context.target)).toMatchObject({ state: "GOOD", sequence: 4 });
      const reactivated = await context.read();
      expect(reactivated.identities.find((item) => item.uid === missingUid)).toMatchObject({ status: "ACTIVE", missingGoodRuns: 0, missingSince: null });
      expect(reactivated.events.map((event) => event.type)).toEqual(["INACTIVATED", "REACTIVATED"]);
    } finally { context.cleanup(); }
  });

  it("preserves pre-revision identities on baseline and requires both run and elapsed-time grace", async () => {
    const context = await setup("default-v1", { ...BOOTSTRAP_SOURCE_SAFETY_POLICY,
      deactivationEnabled: true, inactiveAfterMissingHours: 24, inactiveAfterMissingGoodRuns: 1 });
    const job: ProjectJobPrincipal = { kind: "project-job", jobName: "source-import", ...context.target, correlationId: randomUUID() };
    try {
      const legacy = await inventoryIdentityCommands.recordSeen(job, { ...context.target, externalOfferId: "legacy",
        sourceHash: "a".repeat(64), normalizedHash: "b".repeat(64), seenAt: new Date(Date.now() - 48 * 3_600_000) });
      const all = [1, 2, 3, 4, 5].map((id) => offer(String(id)));
      context.provide(feed(...all));
      expect(await context.runtime.run(context.target)).toMatchObject({ state: "GOOD" });
      expect((await context.read()).identities.find((item) => item.uid === legacy.uid)).toMatchObject({ status: "ACTIVE", missingGoodRuns: 0, missingSince: null });
      for (let run = 0; run < 2; run += 1) {
        context.provide(feed(...all.slice(0, 4)));
        expect(await context.runtime.run(context.target)).toMatchObject({ state: "GOOD" });
      }
      const grace = await context.read();
      const missing = grace.identities.find((item) => item.externalOfferId === "5")!;
      expect(missing).toMatchObject({ status: "ACTIVE", missingGoodRuns: 2 });
      expect(grace.events).toHaveLength(0);
      // Age only the isolated synthetic identity clock; immutable GOOD history
      // remains untouched. The next real apply exercises elapsed-time policy.
      await runInPrincipalDatabaseTransaction(job, (tx) => tx.inventoryIdentity.update({
        where: { uid: missing.uid }, data: { missingSince: new Date(Date.now() - 25 * 3_600_000) },
      }));
      context.provide(feed(...all.slice(0, 4)));
      expect(await context.runtime.run(context.target)).toMatchObject({ state: "GOOD" });
      expect((await context.read()).identities.find((item) => item.uid === missing.uid)).toMatchObject({ status: "INACTIVE", missingGoodRuns: 3 });
    } finally { context.cleanup(); }
  });

  it("enforces persisted revision RLS and forbids cross-source or cleared Last Good pointers", async () => {
    const first = await setup();
    const second = await setup();
    try {
      first.provide(feed(offer("one")));
      expect(await first.runtime.run(first.target)).toMatchObject({ state: "GOOD" });
      const baseline = await first.read();
      const job: ProjectJobPrincipal = { kind: "project-job", jobName: "source-import", ...second.target, correlationId: randomUUID() };
      await runInPrincipalDatabaseTransaction(job, async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL ROLE ams_data_hub_worker");
        expect(await tx.$queryRawUnsafe('SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user')).toEqual([{ rolbypassrls: false }]);
        expect(await tx.sourceRevision.findMany({ where: first.target })).toEqual([]);
        expect(await tx.project.findMany({ where: { organizationId: first.target.organizationId, id: first.target.projectId } })).toEqual([]);
        expect(await tx.sourceRevisionRecord.findMany({ where: first.target })).toEqual([]);
        expect((await tx.sourceRevision.updateMany({ where: { id: baseline.source.lastGoodRevisionId! }, data: { failureCode: "TEST_DENIED" } })).count).toBe(0);
      });
      await expect(runInPrincipalDatabaseTransaction(first.principal, (tx) => tx.source.update({
        where: { id: second.target.sourceId }, data: { lastGoodRevisionId: baseline.source.lastGoodRevisionId },
      }))).rejects.toThrow();
      await expect(runInPrincipalDatabaseTransaction(first.principal, (tx) => tx.source.update({
        where: { id: first.target.sourceId }, data: { lastGoodRevisionId: null },
      }))).rejects.toThrow();
      expect((await first.read()).source.lastGoodRevisionId).toBe(baseline.source.lastGoodRevisionId);
    } finally { first.cleanup(); second.cleanup(); }
  });

  it("persists profile-normalized square metres and rejects unknown units or rental periods before GOOD", async () => {
    const context = await setup("vladis-vt24-v1");
    try {
      context.provide(feed(offer("one").replace("</offer>", "<area><value>6</value><unit>сотка</unit></area></offer>")));
      const result = await context.runtime.run(context.target);
      expect(result, JSON.stringify(result)).toMatchObject({ state: "GOOD" });
      const baseline = await context.read();
      expect(baseline.records[0]!.payload).toMatchObject({ draft: { areaM2: 600 } });
      for (const broken of [
        offer("one").replace("</offer>", "<area><value>6</value><unit>unknown</unit></area></offer>"),
        offer("one").replace("продажа", "аренда"),
        offer("one").replace("продажа", "аренда").replace("<price>", '<price period="unknown">'),
      ]) {
        context.provide(feed(broken));
        expect(await context.runtime.run(context.target)).toMatchObject({ state: "FAILED" });
        const current = await context.read();
        expect(current.source.lastGoodRevisionId).toBe(baseline.source.lastGoodRevisionId);
        expect(current.identities).toEqual(baseline.identities);
      }
    } finally { context.cleanup(); }
  });

  it("serializes status-only project changes with runtime apply and rechecks status after intake", async () => {
    const context = await setup();
    try {
      await runInPrincipalDatabaseTransaction(context.principal, async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('ams-data-safety-mutations', 0))`;
        const pending = runInPrincipalDatabaseTransaction(context.principal, async (other) => {
          await other.$executeRawUnsafe("SET LOCAL lock_timeout = '1000ms'");
          await other.project.update({ where: { id: context.target.projectId }, data: { status: "DISABLED", slug: `changed-${randomUUID()}` } });
        }).then(() => false, () => true);
        let waiting = false;
        for (let attempt = 0; attempt < 100; attempt += 1) {
          const locks = await tx.$queryRaw<{ count: bigint }[]>`SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND NOT granted`;
          if (locks[0]!.count > 0n) { waiting = true; break; }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(waiting).toBe(true);
        // A mixed unique-key/status update must not hold the Project key lock
        // while waiting for the runtime advisory lock (FK inserts need it).
        await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '100ms'");
        await tx.$queryRaw`SELECT "id" FROM "Project" WHERE "id" = ${context.target.projectId} FOR KEY SHARE`;
        expect(await pending).toBe(true);
      });
      context.provide(feed(offer("one")));
      expect(await context.runtime.run(context.target)).toMatchObject({ state: "GOOD" });
      const baseline = await context.read();
      context.provide(feed(offer("one", 2000)));
      const response = await gateway();
      gateway.mockImplementationOnce(async () => {
        await runInPrincipalDatabaseTransaction(context.principal, (tx) => tx.project.update({
          where: { id: context.target.projectId }, data: { status: "DISABLED" },
        }));
        return response;
      });
      expect(await context.runtime.run(context.target)).toMatchObject({ state: "FAILED" });
      const current = await context.read();
      expect(current.source.lastGoodRevisionId).toBe(baseline.source.lastGoodRevisionId);
      expect(current.identities).toEqual(baseline.identities);
    } finally { context.cleanup(); }
  });

  it("applies GOOD revision and stable scoped identity from configuration-only Source IDs", async () => {
    const context = await setup();
    try {
      context.provide(feed(offer("one")));
      const result = await context.runtime.run(context.target);
      expect(result).toMatchObject({ state: "GOOD", sourceId: context.target.sourceId, sequence: 1, snapshotTriggered: true });
      const first = await context.read();
      expect(first.source.lastGoodRevisionId).toBe(first.revisions[0]!.id);
      expect(first.revisions[0]).toMatchObject({ status: "GOOD", recordCount: 1, safetyPolicy: BOOTSTRAP_SOURCE_SAFETY_POLICY });
      expect(first.records[0]!.inventoryUid).toBe(first.identities[0]!.uid);
      expect(context.uploaded()).toBeGreaterThan(0);
      context.provide(feed(offer("one", 2000)));
      expect(await context.runtime.run(context.target)).toMatchObject({ state: "GOOD", sequence: 2 });
      const second = await context.read();
      expect(second.identities[0]!.uid).toBe(first.identities[0]!.uid);
      expect(second.revisions[1]!.normalizedContentHash).not.toBe(first.revisions[0]!.normalizedContentHash);
      const serialized = JSON.stringify(second.revisions);
      expect(serialized).not.toContain("synthetic.example.test");
      expect(serialized).not.toContain("synthetic-runtime-only");
    } finally { context.cleanup(); }
  });

  it("retains GOOD and current identities after malformed XML, duplicate IDs and rejected empty feed", async () => {
    const context = await setup();
    try {
      context.provide(feed(offer("one")));
      expect(await context.runtime.run(context.target)).toMatchObject({ state: "GOOD" });
      const baseline = await context.read();
      for (const broken of ["<realty-feed>", feed(offer("one"), offer("one")), feed()]) {
        context.provide(broken);
        expect(await context.runtime.run(context.target)).toMatchObject({ state: "FAILED" });
        const current = await context.read();
        expect(current.source.lastGoodRevisionId).toBe(baseline.source.lastGoodRevisionId);
        expect(current.identities).toEqual(baseline.identities);
      }
      expect((await context.read()).revisions.map((revision) => revision.status)).toEqual(["GOOD", "FAILED", "FAILED", "REJECTED"]);
    } finally { context.cleanup(); }
  });

  it("persists SUSPICIOUS staged facts without replacing Last Good or applying a destructive plan", async () => {
    const context = await setup();
    try {
      context.provide(feed(...[1, 2, 3, 4, 5].map((id) => offer(String(id)))));
      expect(await context.runtime.run(context.target)).toMatchObject({ state: "GOOD" });
      const baseline = await context.read();
      context.provide(feed(offer("1")));
      expect(await context.runtime.run(context.target)).toMatchObject({ state: "FAILED", code: "IMPORT_REQUIRES_APPROVAL" });
      const current = await context.read();
      expect(current.source.lastGoodRevisionId).toBe(baseline.source.lastGoodRevisionId);
      expect(current.identities).toEqual(baseline.identities);
      expect(current.revisions.at(-1)).toMatchObject({ status: "SUSPICIOUS", recordCount: 1 });
      expect(current.records.filter((record) => record.revisionId === current.revisions.at(-1)!.id)).toHaveLength(1);
    } finally { context.cleanup(); }
  });

  it("blocks frozen or disabled sources before outbound and protects GOOD records from changes", async () => {
    const context = await setup();
    try {
      context.provide(feed(offer("one")));
      expect(await context.runtime.run(context.target)).toMatchObject({ state: "GOOD" });
      const baseline = await context.read();
      await expect(runInPrincipalDatabaseTransaction(context.principal, (tx) => tx.sourceRevisionRecord.update({
        where: { revisionId_externalId: { revisionId: baseline.source.lastGoodRevisionId!, externalId: "one" } }, data: { recordHash: "c".repeat(64) },
      }))).rejects.toThrow();
      await runInPrincipalDatabaseTransaction(context.principal, (tx) => tx.dataSafetyState.update({ where: { id: "global" }, data: { jobsFrozen: true } }));
      gateway.mockClear();
      expect(await context.runtime.run(context.target)).toMatchObject({ state: "FAILED" });
      expect(gateway).not.toHaveBeenCalled();
    } finally { context.cleanup(); }
  });
});
