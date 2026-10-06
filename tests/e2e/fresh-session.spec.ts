import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import pg from "pg";

async function withDatabase<T>(run: (client: pg.Client) => Promise<T>): Promise<T> {
  if (process.env.APP_ENV !== "test" || process.env.DATABASE_HOST !== "127.0.0.1"
    || !process.env.DATABASE_NAME?.endsWith("_test") || !process.env.DATABASE_USER?.includes("test")) {
    throw new Error("Session E2E requires the isolated loopback test identity");
  }
  const client = new pg.Client({ host: process.env.DATABASE_HOST, port: Number(process.env.DATABASE_PORT), database: process.env.DATABASE_NAME, user: process.env.DATABASE_USER, password: process.env.DATABASE_PASSWORD, ssl: false });
  await client.connect();
  try { return await run(client); } finally { await client.end(); }
}

async function createAccount(role: "USER" | "PLATFORM_ADMIN") {
  const id = `session-e2e-${randomUUID()}`;
  const username = `u_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
  const password = `Synthetic-session-${randomUUID()}`;
  const passwordHash = await hashPassword(password);
  await withDatabase(async (client) => {
    await client.query('insert into "User" ("id", "name", "username", "email", "emailVerified", "systemRole", "createdAt", "updatedAt") values ($1, $2, $3, $4, true, $5::"SystemRole", now(), now())', [id, "Synthetic session user", username, `${id}@example.test`, role]);
    await client.query('insert into "Account" ("id", "userId", "accountId", "providerId", "password", "createdAt", "updatedAt") values ($1, $2, $2, $3, $4, now(), now())', [randomUUID(), id, "credential", passwordHash]);
  });
  return { id, username, password };
}

async function signIn(page: Page, account: Awaited<ReturnType<typeof createAccount>>) {
  const response = await page.request.post("/api/auth/sign-in/username", { data: { username: account.username, password: account.password, rememberMe: true } });
  expect(response.ok()).toBe(true);
  expect(await response.json()).not.toHaveProperty("twoFactorRedirect");
}

test("a disabled admin loses private access on the next request with the old cookie", async ({ page }) => {
  const account = await createAccount("PLATFORM_ADMIN");
  await signIn(page, account);
  await page.goto("/admin/catalog/");
  await expect(page.getByRole("heading", { name: "Каталог", exact: true })).toBeVisible();
  await withDatabase((client) => client.query('update "User" set "disabledAt" = now() where "id" = $1', [account.id]));
  await page.goto("/admin/catalog/");
  await expect(page).toHaveURL(/\/?\?login=1$/);
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("a revoked persisted session denies private access despite an existing cookie", async ({ page }) => {
  const account = await createAccount("PLATFORM_ADMIN");
  await signIn(page, account);
  await page.goto("/admin/catalog/");
  await expect(page.getByRole("heading", { name: "Каталог", exact: true })).toBeVisible();
  await withDatabase((client) => client.query('delete from "Session" where "userId" = $1', [account.id]));
  await page.goto("/admin/catalog/");
  await expect(page).toHaveURL(/\/?\?login=1$/);
});

test("multiple memberships require selection and never grant platform authority", async ({ page }) => {
  const account = await createAccount("USER");
  const organizations = [randomUUID(), randomUUID()];
  await withDatabase(async (client) => {
    for (const [index, id] of organizations.entries()) {
      await client.query('insert into "Organization" ("id", "slug", "name", "createdAt", "updatedAt") values ($1, $2, $3, now(), now())', [id, `session-e2e-${id}`, `Synthetic session organization ${index + 1}`]);
      await client.query('insert into "Member" ("id", "organizationId", "userId", "tenantRole", "createdAt", "updatedAt") values ($1, $2, $3, $4, now(), now())', [randomUUID(), id, account.id, "ORG_VIEWER"]);
    }
  });
  await signIn(page, account);
  await page.goto("/dashboard/");
  await expect(page).toHaveURL(/\/organization\/?$/);
  await expect(page.getByRole("heading", { name: "Выберите организацию" })).toBeVisible();
  await page.getByRole("button", { name: "Synthetic session organization 2" }).click();
  await expect(page).toHaveURL(/\/dashboard\/?$/);
  const persisted = await withDatabase((client) => client.query<{ activeOrganizationId: string }>('select "activeOrganizationId" from "Session" where "userId" = $1', [account.id]));
  expect(persisted.rows[0]?.activeOrganizationId).toBe(organizations[1]);
  await page.goto("/admin/catalog/");
  await expect(page).toHaveURL(/\/dashboard\/?$/);
  await expect(page.getByRole("heading", { name: "Каталог", exact: true })).not.toBeVisible();
});
