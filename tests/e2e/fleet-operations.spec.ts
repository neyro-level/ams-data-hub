import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import pg from "pg";

const username = "integration_platform_admin";
const password = `Synthetic-fleet-${randomUUID()}`;
const projectId = `fleet-e2e-${randomUUID()}`;
const projectName = `Synthetic Fleet action state ${projectId.slice(-8)}`;

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
    await client.query('UPDATE "User" SET "disabledAt"=NULL,"emailVerified"=true,"setupCompletedAt"=now(),"systemRole"=\'PLATFORM_ADMIN\',"updatedAt"=now() WHERE id=$1', [userId]);
    await client.query(`INSERT INTO "Account" (id,"userId","accountId","providerId",password,"createdAt","updatedAt")
      VALUES ($1,$2,$2,'credential',$3,now(),now()) ON CONFLICT ("providerId","accountId")
      DO UPDATE SET password=excluded.password,"updatedAt"=now()`, [randomUUID(), userId, await hashPassword(password)]);
    const organizations = await client.query<{ id: string }>('SELECT id FROM "Organization" WHERE slug=\'ams-data-hub\'');
    const organizationId = organizations.rows[0]?.id;
    if (!organizationId) throw new Error("SYNTHETIC_ORGANIZATION_MISSING");
    await client.query('INSERT INTO "Project" (id,"organizationId",slug,name,"createdAt","updatedAt") VALUES ($1,$2,$1,$3,now(),now())', [projectId, organizationId, projectName]);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { await client.end(); }
});

test("Fleet shows accepted request separately from publication at responsive widths", async ({ page }) => {
  const response = await page.request.post("/api/auth/sign-in/username", { data: { username, password } });
  expect(response.ok()).toBe(true);
  await page.goto("/admin/fleet/");
  const project = page.getByRole("article").filter({ has: page.getByRole("heading", { name: projectName, exact: true }) });
  await expect(project.getByText("Операционных запросов ещё нет.")).toBeVisible();
  await page.getByRole("combobox", { name: /^Действие/u }).selectOption("SNAPSHOT_BUILD");
  await expect(page.getByRole("combobox", { name: /^Действие/u })).toHaveValue("SNAPSHOT_BUILD");
  await expect(page.getByRole("combobox", { name: /^Источник/u })).toHaveCount(0);
  await page.getByRole("combobox", { name: /^Проект/u }).selectOption(projectId);
  await page.getByRole("button", { name: "Записать запрос", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Запрос принят");
  await expect(page.getByRole("status")).toContainText("не подтверждение выполнения");
  await expect(project.getByText("SNAPSHOT_BUILD · REQUESTED", { exact: true })).toBeVisible();
  await expect(project.getByText("Запрос принят — ожидает исполнителя", { exact: true })).toBeVisible();
  await expect(project.getByText("Snapshot опубликован", { exact: true })).toHaveCount(0);
  await expect(project.getByText("Нет публикации", { exact: true })).toBeVisible();
  for (const width of [375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(project.getByText("SNAPSHOT_BUILD · REQUESTED", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
    await page.screenshot({ path: test.info().outputPath(`fleet-${width}.png`), fullPage: true });
  }
  await page.reload();
  await expect(project.getByText("SNAPSHOT_BUILD · REQUESTED", { exact: true })).toBeVisible();
});
