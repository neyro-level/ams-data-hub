import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test as setup } from "@playwright/test";
import { adminAuthStatePath } from "./auth-state.ts";

setup("authenticate platform administrator", async ({ page }) => {
  await page.goto("/?login=1");
  await page.getByLabel("Логин").fill("e2e.platform.admin");
  await page.getByLabel("Пароль").fill("E2e!2026");
  await page
    .getByRole("dialog", { name: "Вход в кабинет" })
    .getByRole("button", { name: "Войти", exact: true })
    .click();
  await expect(page).toHaveURL(/\/dashboard\/?$/);
  await mkdir(path.dirname(adminAuthStatePath), { recursive: true });
  await page.context().storageState({ path: adminAuthStatePath });
});
