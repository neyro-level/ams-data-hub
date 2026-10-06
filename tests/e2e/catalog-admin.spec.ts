import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import pg from "pg";

const username = "integration_platform_admin";
const password = `E2e-${randomUUID()}`;

function createDatabaseClient() {
  return new pg.Client({
    host: process.env.DATABASE_HOST,
    port: Number(process.env.DATABASE_PORT),
    database: process.env.DATABASE_NAME,
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    ssl: process.env.DATABASE_SSLMODE === "require",
  });
}

test.beforeAll(async () => {
  const client = createDatabaseClient();
  await client.connect();
  try {
    const user = await client.query<{ id: string }>('select "id" from "User" where "username" = $1', [username]);
    const userId = user.rows[0]?.id;
    if (!userId) throw new Error("Synthetic platform admin is missing");
    const passwordHash = await hashPassword(password);
    await client.query("begin");
    await client.query('update "User" set "disabledAt" = null, "emailVerified" = true, "setupCompletedAt" = now(), "systemRole" = \'PLATFORM_ADMIN\', "updatedAt" = now() where "id" = $1', [userId]);
    await client.query(`insert into "Account" ("id", "userId", "accountId", "providerId", "password", "createdAt", "updatedAt")
      values ($1, $2, $2, 'credential', $3, now(), now())
      on conflict ("providerId", "accountId") do update set "userId" = excluded."userId", "password" = excluded."password", "updatedAt" = now()`, [randomUUID(), userId, passwordHash]);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.end();
  }
});

test("platform admin manages the shared catalog without horizontal overflow", async ({ page }, testInfo) => {
  const suffix = testInfo.project.name.replace(/[^a-z0-9]/gi, "-");
  const projectIp = {
    "mobile-375": "198.51.100.21",
    "tablet-768": "198.51.100.22",
    "desktop-1280": "198.51.100.23",
    "desktop-1440": "198.51.100.24",
  }[testInfo.project.name] ?? "198.51.100.25";
  const developerName = `Тест Девелопмент ${suffix}`;
  const developmentName = `ЖК Проверка ${suffix}`;
  const buildingLabel = `Корпус ${suffix}`;

  await page.setExtraHTTPHeaders({ "x-forwarded-for": projectIp });
  await page.goto("/?login=1");
  const loginDialog = page.getByRole("dialog");
  await loginDialog.getByLabel("Логин", { exact: true }).fill(username);
  await loginDialog.getByLabel("Пароль", { exact: true }).fill(password);
  const [signInResponse] = await Promise.all([
    page.waitForResponse((response) => response.url().endsWith("/api/auth/sign-in/username")),
    loginDialog.getByRole("button", { name: "Войти", exact: true }).click(),
  ]);
  expect(signInResponse.ok()).toBe(true);
  expect(await signInResponse.json()).not.toHaveProperty("twoFactorRedirect");
  await expect(loginDialog).not.toBeVisible();
  await page.waitForURL(/\/(dashboard|admin)(\/|$)/);
  await expect(page.getByText("Нейтральная рабочая область для будущих кабинетов, CRM, аналитики и внутренних процессов.", { exact: true })).toBeVisible();
  await page.goto("/admin/catalog/");

  await expect(page.getByRole("heading", { name: "Каталог", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Застройщики", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "История изменений", exact: true })).toBeVisible();
  await expect(page.getByText("Быстро добавить корпуса")).toBeVisible();

  const developerForm = page.locator("form").filter({ has: page.getByRole("button", { name: "Создать застройщика" }) });
  await developerForm.locator('input[name="name"]').fill(developerName);
  await developerForm.getByRole("button", { name: "Создать застройщика" }).click();
  await expect(page.getByText("Застройщик создан")).toBeVisible();

  const developmentForm = page.locator("form").filter({ has: page.getByRole("button", { name: "Создать ЖК" }) });
  await developmentForm.locator('input[name="name"]').fill(developmentName);
  await developmentForm.locator('select[name="developerUid"]').selectOption({ label: developerName });
  await developmentForm.locator('select[name="cityUid"]').selectOption({ label: "Краснодар" });
  await developmentForm.getByRole("button", { name: "Создать ЖК" }).click();
  await expect(page.getByText("Жилой комплекс создан")).toBeVisible();

  const buildingForm = page.locator("form").filter({ has: page.getByRole("button", { name: "Создать корпус" }) });
  await buildingForm.locator('input[name="label"]').fill(buildingLabel);
  await buildingForm.locator('select[name="developmentUid"]').selectOption({ label: developmentName });
  await buildingForm.getByRole("button", { name: "Создать корпус" }).click();
  await expect(page.getByText("Корпус создан")).toBeVisible();
  await expect(page.getByText(buildingLabel, { exact: true }).filter({ visible: true })).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
});
