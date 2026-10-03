import { expect, test } from "@playwright/test";

test("public Data Hub page has no horizontal overflow", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "AMS Data Hub" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
});

test("legal pages stay available", async ({ page }) => {
  for (const route of ["/politika/", "/soglasie/", "/cookies/", "/terms/"]) {
    await page.goto(route);
    await expect(page.locator("header").getByRole("link", { name: /AMS Data Hub/ })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflow).toBe(false);
  }
});

test("PWA manifest is available", async ({ page }) => {
  const response = await page.goto("/manifest.webmanifest");
  expect(response?.ok()).toBe(true);
  const payload = await page.evaluate(() => document.body.innerText);
  expect(payload).toContain("AMS Data Hub");
});

test("offline page is available", async ({ page }) => {
  await page.goto("/offline/");
  await expect(page.getByRole("heading", { name: /Откройте страницу снова/ })).toBeVisible();
});

test("API responses are not cacheable", async ({ page }) => {
  const response = await page.request.get("/api/health/live");
  expect(response.headers()["cache-control"]).toContain("no-store");
});

test("authentication endpoint throttles repeated invalid credentials", async ({ page }, testInfo) => {
  const username = `missing_${testInfo.project.name.replace(/[^a-z0-9]/gi, "_")}`;
  const responses = [];
  for (let attempt = 0; attempt < 6; attempt += 1) {
    responses.push(await page.request.post("/api/auth/sign-in/username", {
      data: { username, password: "not-a-real-password" },
    }));
  }
  expect(responses.map((response) => response.status())).toEqual([401, 401, 401, 401, 401, 429]);
});
