import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { scanText } from "../scripts/ci/scan-secrets.mjs";

const fixtureDirectory = path.resolve("tests/fixtures/yrl/vladis-vt24");
const requiredFiles = [
  "agent-with-photo.xml",
  "agent-without-photo.xml",
  "apartment-rent.xml",
  "apartment-sale.xml",
  "cottage.xml",
  "garage-box.xml",
  "house-part.xml",
  "house.xml",
  "invalid-cadastral.xml",
  "land.xml",
  "malformed.xml",
  "missing-optional-fields.xml",
  "placeholder-cadastral.xml",
  "room.xml",
  "townhouse.xml",
  "truncated.xml",
] as const;
const intentionalInvalid = new Set(["malformed.xml", "truncated.xml"]);
const allowedSyntheticPhones = new Set([
  "+7 959 000-00-01",
  "+7 959 000-00-02",
  "+7 959 000-00-99",
]);
const phonePattern = /\+7[\s()-]*\d{3}[\s()-]*\d{3}[\s()-]*\d{2}[\s()-]*\d{2}/gu;
const urlPattern = /https?:\/\/[^<\s"']+/gu;
const yrlNamespace = "http://webmaster.yandex.ru/schemas/feed/realty/2010-06";

function readFixture(file: string): string {
  return readFileSync(path.join(fixtureDirectory, file), "utf8");
}

describe("sanitized vladis-vt24 fixture corpus", () => {
  it("contains exactly the 16 fixtures required by the contract", () => {
    expect(readdirSync(fixtureDirectory).sort()).toEqual([...requiredFiles]);
  });

  it.each(requiredFiles)("marks %s as synthetic and contains no secret pattern", (file) => {
    const text = readFixture(file);
    expect(text).toContain('data-synthetic="true"');
    expect(text).toContain('xmlns="http://webmaster.yandex.ru/schemas/feed/realty/2010-06"');
    expect(scanText(text)).toEqual([]);
    expect(text).not.toMatch(/(?:advert-feed|vladis\.vt24\.ru|bastion|@)/iu);
  });

  it.each(requiredFiles)("allows only synthetic media hosts and enumerated fixture phones in %s", (file) => {
    const text = readFixture(file);
    for (const url of text.match(urlPattern) ?? []) {
      if (url === yrlNamespace) continue;
      expect(new URL(url).hostname).toBe("media.example.invalid");
    }
    for (const phone of text.match(phonePattern) ?? []) {
      expect(allowedSyntheticPhones).toContain(phone);
    }
  });

  it("keeps ordinary fixtures structurally complete and invalid fixtures intentionally broken", () => {
    for (const file of requiredFiles) {
      const text = readFixture(file);
      if (intentionalInvalid.has(file)) continue;
      expect(text.trimEnd().endsWith("</realty-feed>")).toBe(true);
      expect((text.match(/<offer\b/gu) ?? []).length).toBe((text.match(/<\/offer>/gu) ?? []).length);
    }
    expect(readFixture("malformed.xml")).toContain("<type>продажа</category>");
    expect(readFixture("truncated.xml").trimEnd().endsWith("</realty-feed>")).toBe(false);
  });

  it("covers every verified category alias and the required safety cases", () => {
    const corpus = requiredFiles.map(readFixture).join("\n");
    for (const category of ["квартира", "комната", "house", "часть дома", "lot", "дача", "таунхаус", "гараж", "box"]) {
      expect(corpus).toContain(`<category>${category}</category>`);
    }
    expect(corpus).toContain("+7 959 000-00-01");
    expect(corpus).toContain("<apartment>42-ТЕСТ</apartment>");
    expect(corpus).toContain("Код объекта: SYN-APT-1.");
    expect(corpus).toContain("00:00:0000000:0");
    expect(corpus).toContain("INVALID-SYNTHETIC");
    expect(corpus).toContain("<is-image-order-change-allowed>false</is-image-order-change-allowed>");
  });
});
