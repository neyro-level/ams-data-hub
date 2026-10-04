import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import pg from "pg";

const username = "integration_platform_admin";
const password = `Contact-E2e-${randomUUID()}`;

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

async function markPlatformAdminSessionMfaVerified() {
  const client = createDatabaseClient();
  await client.connect();
  try {
    const result = await client.query(
      `update "Session"
       set "twoFactorVerifiedAt" = now(), "updatedAt" = now()
       where "userId" = (select "id" from "User" where "username" = $1)`,
      [username],
    );
    if (result.rowCount === 0) throw new Error("Synthetic platform admin session is missing");
  } finally {
    await client.end();
  }
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

test("platform admin saves the project fallback contact without horizontal overflow", async ({ page }, testInfo) => {
  const suffix = testInfo.project.name.replace(/[^a-z0-9]/gi, "-");
  const projectIp = {
    "mobile-375": "198.51.100.31",
    "tablet-768": "198.51.100.32",
    "desktop-1280": "198.51.100.33",
    "desktop-1440": "198.51.100.34",
  }[testInfo.project.name] ?? "198.51.100.35";
  const phone = `+7 900 44${testInfo.project.name.length}-00-00`;

  const signInResponse = await page.request.post("/api/auth/sign-in/username", {
    headers: { "x-forwarded-for": projectIp },
    data: { username, password, rememberMe: true },
  });
  expect(signInResponse.ok()).toBe(true);
  await markPlatformAdminSessionMfaVerified();
  await page.goto("/admin/projects/");

  const contactForm = page.locator("form").filter({ has: page.getByRole("button", { name: "Сохранить контакт" }) }).first();
  await expect(contactForm.getByText("Публичный контакт", { exact: true })).toBeVisible();
  await contactForm.locator('input[name="phone"]').fill(phone);
  await contactForm.locator('input[name="email"]').fill(`${suffix}@example.test`);
  await contactForm.locator('textarea[name="addressPublic"]').fill(`Публичный адрес ${suffix}`);
  await contactForm.locator('textarea[name="messengersText"]').fill(`https://t.me/${suffix}`);
  await contactForm.locator('textarea[name="hours"]').fill("Пн–Пт, 09:00–18:00");
  await contactForm.getByRole("button", { name: "Сохранить контакт" }).click();
  await expect(page.getByText("Публичный контакт сохранён")).toBeVisible();
  await expect(contactForm.locator('input[name="phone"]')).toHaveValue(phone);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
});
