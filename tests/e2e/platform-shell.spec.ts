import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

const productIdentity = JSON.parse(readFileSync("project.identity.json", "utf8")).identity as {
  productName: string;
};

test("public Data Hub page has no horizontal overflow", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: productIdentity.productName })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
});

test("the privacy policy stays available and visibly requires legal review", async ({ page }) => {
  await page.goto("/politika/");
  await expect(page.locator("header").getByRole("link", { name: new RegExp(productIdentity.productName) })).toBeVisible();
  await expect(page.getByText("Требует юридической проверки владельцем")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
});

test("removed public routes return not found", async ({ page }) => {
  for (const route of ["/soglasie/", "/cookies/", "/terms/", "/offline/", "/manifest.webmanifest", "/sitemap.xml", "/sw.js"]) {
    const response = await page.goto(route);
    expect(response?.status(), route).toBe(404);
  }
});

test("robots disallows the complete site", async ({ page }) => {
  const response = await page.goto("/robots.txt");
  expect(response?.ok()).toBe(true);
  await expect(page.locator("body")).toContainText("Disallow: /");
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
