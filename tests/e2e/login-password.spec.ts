import { expect, test } from "@playwright/test";

test("login dialog exposes only username/password with keyboard and bounded layout", async ({ page }) => {
  await page.goto("/?login=1");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Логин", { exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByLabel("Пароль", { exact: true })).toBeFocused();
  await expect(dialog.locator('input[autocomplete="one-time-code"]')).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Войти", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
  await page.screenshot({ path: test.info().outputPath("password-login.png"), fullPage: true });
  if (test.info().project.name === "desktop-1280") {
    await page.setViewportSize({ width: 1024, height: 800 });
    await expect(dialog.getByLabel("Пароль", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
    await page.screenshot({ path: test.info().outputPath("password-login-1024.png"), fullPage: true });
  }
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
});

test("invalid login response preserves the password form and reports a safe error", async ({ page }) => {
  // Presentation proof only; real password/session authorization is proved by
  // the MP-01 integration and non-mocked authenticated E2E scenarios.
  await page.route("**/api/auth/sign-in/username", async (route) => {
    await route.fulfill({ status: 401, json: { code: "INVALID_CREDENTIALS", message: "Invalid credentials" } });
  });
  await page.goto("/?login=1");
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Логин", { exact: true }).fill("synthetic_login");
  await dialog.getByLabel("Пароль", { exact: true }).fill("synthetic-password");
  await dialog.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Проверьте логин и пароль");
  await expect(dialog.getByLabel("Логин", { exact: true })).toHaveValue("synthetic_login");
  await expect(dialog.getByRole("button", { name: "Войти", exact: true })).toBeEnabled();
  await expect(dialog.locator('input[autocomplete="one-time-code"]')).toHaveCount(0);
});
