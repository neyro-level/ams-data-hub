import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import pg from "pg";

const username = "integration_platform_admin";
const password = `Synthetic-fleet-${randomUUID()}`;
const projectId = `fleet-e2e-${randomUUID()}`;
const projectName = `Synthetic Fleet action state ${projectId.slice(-8)}`;
const sourceId = `source-${randomUUID()}`;
const revisionId = `revision-${randomUUID()}`;
const auditAction = `synthetic.fleet.proof.${projectId}`;

test.beforeAll(async () => {
  const client = new pg.Client({ host: process.env.DATABASE_HOST, port: Number(process.env.DATABASE_PORT),
    database: process.env.DATABASE_NAME, user: process.env.DATABASE_USER, password: process.env.DATABASE_PASSWORD,
    ssl: process.env.DATABASE_SSLMODE === "require" });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.principal_kind','platform-admin',true)");
    const users = await client.query<{ id: string }>('SELECT id FROM "User" WHERE username=$1', [username]);
    const userId = users.rows[0]?.id;
    if (!userId) throw new Error("SYNTHETIC_ADMIN_MISSING");
    await client.query("SELECT set_config('app.actor_id',$1,true)", [userId]);
    await client.query('UPDATE "User" SET "disabledAt"=NULL,"emailVerified"=true,"setupCompletedAt"=now(),"systemRole"=\'PLATFORM_ADMIN\',"updatedAt"=now() WHERE id=$1', [userId]);
    await client.query(`INSERT INTO "Account" (id,"userId","accountId","providerId",password,"createdAt","updatedAt")
      VALUES ($1,$2,$2,'credential',$3,now(),now()) ON CONFLICT ("providerId","accountId")
      DO UPDATE SET password=excluded.password,"updatedAt"=now()`, [randomUUID(), userId, await hashPassword(password)]);
    const organizations = await client.query<{ id: string }>('SELECT id FROM "Organization" WHERE slug=\'ams-data-hub\'');
    const organizationId = organizations.rows[0]?.id;
    if (!organizationId) throw new Error("SYNTHETIC_ORGANIZATION_MISSING");
    await client.query('INSERT INTO "Project" (id,"organizationId",slug,name,"createdAt","updatedAt") VALUES ($1,$2,$1,$3,now(),now())', [projectId, organizationId, projectName]);
    await client.query(`INSERT INTO "Source" (id,"organizationId","projectId","sourceKey",name,"adapterKey","adapterVersion","profileKey","profileVersion","datasetType","schedulePolicy",enabled,"lastAttemptAt","lastSuccessAt","createdAt","updatedAt")
      VALUES ($1,$2,$3,$4,'Fleet browser source','yrl-realty-2010','1.0.0','vladis-vt24-v1','1.0.0','RESALE',$5::jsonb,true,now(),now(),now(),now())`,
      [sourceId, organizationId, projectId, `fleet-${sourceId}`, JSON.stringify({ mode: "MANUAL_ONLY" })]);
    await client.query(`INSERT INTO "SourceCredentialRef" (id,"organizationId","projectId","sourceId","endpointCredentialRefName","createdAt","updatedAt")
      VALUES ($1,$2,$3,$4,'SYNTHETIC_FLEET_ENDPOINT_CREDENTIAL',now(),now())`,
      [randomUUID(), organizationId, projectId, sourceId]);
    await client.query(`INSERT INTO "SourceRevision" (id,"organizationId","projectId","sourceId","sourceVersion","adapterKey","adapterVersion","profileKey","profileVersion","safetyPolicy","recordCount","invalidRecordCount","startedAt")
      VALUES ($1,$2,$3,$4,1,'yrl-realty-2010','1.0.0','vladis-vt24-v1','1.0.0','{}'::jsonb,0,0,now())`,
      [revisionId, organizationId, projectId, sourceId]);
    await client.query('UPDATE "SourceRevision" SET status=\'STAGED\',sequence=1,"rawStorageKey"=\'synthetic/private\',"rawArtifactHash"=$2,"rawByteCount"=1,"normalizedContentHash"=$3,"completedAt"=now() WHERE id=$1',
      [revisionId, "a".repeat(64), "b".repeat(64)]);
    await client.query('UPDATE "SourceRevision" SET status=\'GOOD\' WHERE id=$1', [revisionId]);
    await client.query('UPDATE "Source" SET "lastGoodRevisionId"=$2 WHERE id=$1', [sourceId, revisionId]);
    await client.query(`INSERT INTO "ProjectCurrentSnapshotManifest" ("organizationId","projectId","publishSequence","manifestKey","manifestSha256","publishedAt","createdAt","updatedAt")
      VALUES ($1,$2,3,'synthetic/private/manifest.json',$3,now(),now(),now())`, [organizationId, projectId, "c".repeat(64)]);
    await client.query(`INSERT INTO "DeliveryRun" (id,"organizationId","projectId","publishSequence","manifestKey","manifestSha256",status,"publishedAt","acknowledgedAt","createdAt","updatedAt")
      VALUES ($1,$2,$3,3,'synthetic/private/manifest.json',$4,'ACKNOWLEDGED',now(),now(),now(),now())`,
      [randomUUID(), organizationId, projectId, "c".repeat(64)]);
    await client.query(`INSERT INTO "Notification" (id,"organizationId","projectId",category,severity,visibility,title,message,route,"sourceType","sourceId","dedupKey","occurredAt","createdAt")
      VALUES ($1,$2,$3,'PROJECT','WARNING','PLATFORM_ADMIN_ONLY','Импорт требует решения','Synthetic safe operational alert.','/admin/fleet/','SourceRevision',$4,$5,now(),now())`,
      [randomUUID(), organizationId, projectId, revisionId, `fleet-e2e-alert-${projectId}`]);
    await client.query(`INSERT INTO "AuditEvent" (id,"organizationId","actorType","actorId",action,"entityType","entityId",source,"correlationId","createdAt")
      VALUES ($1,$2,'USER',$3,$4,'Project',$5,'fleet-e2e',$6,now())`,
      [randomUUID(), organizationId, userId, auditAction, projectId, randomUUID()]);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { await client.end(); }
});

test("Fleet proves the operator view and keeps accepted requests separate from completion", async ({ page }) => {
  const response = await page.request.post("/api/auth/sign-in/username", { data: { username, password } });
  expect(response.ok()).toBe(true);
  await page.goto("/admin/fleet/");
  const project = page.getByRole("article").filter({ has: page.getByRole("heading", { name: projectName, exact: true }) });
  await expect(project.getByText("Операционных запросов ещё нет.")).toBeVisible();
  await expect(project.getByText("Fleet browser source", { exact: true })).toBeVisible();
  await expect(project.getByText("GOOD", { exact: true })).toHaveCount(2);
  await expect(project.getByText("Sequence 3", { exact: true })).toHaveCount(2);
  await expect(project.getByText("ACKNOWLEDGED", { exact: true })).toBeVisible();
  await expect(project.getByText("Подтверждён", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Последние алерты" })).toBeVisible();
  const alert = page.getByRole("row").filter({ hasText: projectName }).filter({ hasText: "Импорт требует решения" });
  await expect(alert).toHaveCount(1); await expect(alert).toBeVisible();
  await expect(page.getByText(auditAction, { exact: true })).toBeVisible();
  const projectSelect = page.getByRole("combobox", { name: /^Проект/u });
  await projectSelect.selectOption(projectId); await expect(projectSelect).toHaveValue(projectId);
  const sourceSelect = page.getByRole("combobox", { name: /^Источник/u });
  await sourceSelect.selectOption(sourceId); await expect(sourceSelect).toHaveValue(sourceId);
  await page.getByRole("button", { name: "Записать запрос", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Запрос принят");
  await expect(page.getByRole("status")).toContainText("проверяйте состояние источника и jobs");
  await page.getByRole("combobox", { name: /^Действие/u }).selectOption("SNAPSHOT_BUILD");
  await expect(page.getByRole("combobox", { name: /^Действие/u })).toHaveValue("SNAPSHOT_BUILD");
  await expect(page.getByRole("combobox", { name: /^Источник/u })).toHaveCount(0);
  await projectSelect.selectOption(projectId);
  await page.getByRole("button", { name: "Записать запрос", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Запрос принят");
  await expect(page.getByRole("status")).toContainText("не подтверждение выполнения");
  await expect(project.getByText("SNAPSHOT_BUILD · REQUESTED", { exact: true })).toBeVisible();
  await expect(project.getByText("Запрос принят — ожидает исполнителя", { exact: true })).toBeVisible();
  await expect(project.getByText("Snapshot опубликован", { exact: true })).toHaveCount(0);
  await expect(project.getByText("Sequence 3", { exact: true })).toHaveCount(2);
  for (const width of [375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(project.getByText("SNAPSHOT_BUILD · REQUESTED", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
    await page.screenshot({ path: test.info().outputPath(`fleet-${width}.png`), fullPage: true });
  }
  await page.reload();
  await expect(project.getByText("SNAPSHOT_BUILD · REQUESTED", { exact: true })).toBeVisible();
});
