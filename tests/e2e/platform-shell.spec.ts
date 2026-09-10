import { expect, test } from "@playwright/test";
import { adminAuthStatePath } from "./auth-state.ts";

const syntheticAlphaProjectName = "Synthetic Alpha Organization";

test("preserves the public AMS IMPULSE surface", async ({ page, request }) => {
  await page.goto("/");

  await expect(page).toHaveTitle("Быстрое продвижение сайтов в SEO");
  await expect(
    page.getByRole("heading", { level: 1, name: "Быстрое продвижение сайтов в SEO" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /бесплатный тест-драйв/i })).toBeVisible();
  await expect(page.getByRole("contentinfo")).toBeVisible();

  const faviconResponse = await request.get("/ams-favicon.svg");
  expect(faviconResponse.status()).toBe(200);
  expect(faviconResponse.headers()["content-type"]).toContain("image/svg+xml");

  const healthResponse = await request.get("/api/health/live");
  expect(healthResponse.status()).toBe(200);
  const health = (await healthResponse.json()) as {
    status: string;
    releaseSha: string | null;
    correlationId: string;
  };
  expect(health).toMatchObject({ status: "ok", releaseSha: null });
  expect(health.correlationId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  expect(healthResponse.headers()["x-correlation-id"]).toBe(health.correlationId);

  const authResponse = await request.get("/api/auth/get-session");
  expect(authResponse.status()).toBe(200);
  expect(await authResponse.json()).toBeNull();

  for (const removedPath of ["/setup/", "/onboarding/password/", "/onboarding/two-factor/"]) {
    const removedResponse = await request.get(removedPath);
    expect(removedResponse.status()).toBe(404);
  }

  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(hasHorizontalOverflow).toBe(false);
});

test("keeps private routes behind the login boundary", async ({ page }) => {
  await page.goto("/analyst/");

  await expect(page).toHaveURL(/\?login=1$/);
  await expect(page.getByRole("dialog", { name: "Вход в кабинет" })).toBeVisible();
  await expect(page.getByLabel("Логин")).toBeVisible();
  await expect(page.getByLabel("Пароль")).toBeVisible();
});

test("opens the cabinet immediately after the first login", async ({ page }, testInfo) => {
  const usernameByProject: Record<string, string> = {
    "mobile-375": "e2e.client.mobile",
    "tablet-768": "e2e.client.tablet",
    "desktop-1280": "e2e.client.desktop1280",
    "desktop-1440": "e2e.client.desktop1440",
  };
  const username = usernameByProject[testInfo.project.name];
  if (!username) throw new Error(`Missing client identity for ${testInfo.project.name}`);

  await page.goto("/?login=1");
  await page.getByLabel("Логин").fill(username);
  await page.getByLabel("Пароль").fill("E2e!2026");
  await page
    .getByRole("dialog", { name: "Вход в кабинет" })
    .getByRole("button", { name: "Войти", exact: true })
    .click();
  await expect(page).toHaveURL(/\/dashboard\/?$/);
});

test.describe("Platform Admin", () => {
  test.use({ storageState: adminAuthStatePath });

  test("opens for a platform administrator", async ({ page }) => {
    await page.goto("/admin/organizations/");
    await expect(
      page.getByRole("heading", { level: 1, name: "Организации" }),
    ).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Разделы администрирования" }),
    ).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Хлебные крошки" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Создать организацию" })).toBeVisible();
    await expect(page.getByText(/Страница 1 из/i)).toBeVisible();

    if ((page.viewportSize()?.width ?? 0) >= 1024) {
      await expect(page.getByText("Супер админ", { exact: true })).toBeVisible();
      await expect(page.locator("aside")).toHaveCSS("width", "232px");
      const collapseWidget = page.getByRole("button", { name: "Свернуть боковое меню" });
      await expect(collapseWidget).toBeVisible();
      await collapseWidget.click();
      await expect(page.locator("aside")).toHaveCSS("width", "76px");
      const expandWidget = page.getByRole("button", { name: "Развернуть боковое меню" });
      await expect(expandWidget).toBeVisible();
      await expandWidget.click();
      await expect(page.locator("aside")).toHaveCSS("width", "232px");
    }

    await page.goto("/admin/providers/");
    await expect(page.getByRole("heading", { level: 1, name: "Подключения источников" })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Сайт*" })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Источник*" })).toBeVisible();
    await expect(page.getByLabel("Дополнительные настройки").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Создать подключение" })).toBeVisible();

    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(hasHorizontalOverflow).toBe(false);
  });

  test("renders the Project reference slice with URL-owned filters", async ({ page }) => {
    await page.goto("/admin/projects/");
    await expect(page.getByRole("heading", { level: 1, name: "Проекты" })).toBeVisible();
    const createProjectTrigger = page.getByRole("button", { name: "Создать проект" });
    await expect(createProjectTrigger).toBeVisible();
    await createProjectTrigger.click();
    await expect(page.getByLabel("Организация")).toBeVisible();
    await page.getByLabel("Поиск").fill("alpha");
    await page.getByRole("button", { name: "Применить" }).click();
    await expect(page).toHaveURL(/search=alpha/);

    if ((page.viewportSize()?.width ?? 0) < 768) {
      const projectCard = page.locator("article").first();
      await expect(projectCard).toBeVisible();
      await expect(
        projectCard.getByRole("heading", { name: syntheticAlphaProjectName }),
      ).toBeVisible();
    } else {
      const projectTable = page.getByRole("table");
      await expect(projectTable).toBeVisible();
      await expect(
        projectTable.getByText(syntheticAlphaProjectName, { exact: true }).first(),
      ).toBeVisible();
      await projectTable.getByRole("link", { name: "Проект", exact: true }).click();
      await expect(page).toHaveURL(/sort=name/);
    }

    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(hasHorizontalOverflow).toBe(false);
  });
});
