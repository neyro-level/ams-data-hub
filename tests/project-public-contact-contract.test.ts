import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { replaceProjectPublicContactInputSchema } from "../src/modules/project-state/index.ts";

const base = {
  organizationId: "organization-1",
  projectId: "project-1",
  version: 0,
  phone: "+7 900 000-00-00",
  email: "office@example.test",
  addressPublic: "Публичный адрес",
  messengers: ["https://t.me/example"],
  hours: "Пн–Пт, 09:00–18:00",
};

describe("project public contact contract", () => {
  it("accepts bounded public fields and rejects extra or unsafe values", () => {
    expect(replaceProjectPublicContactInputSchema.parse(base)).toMatchObject(base);
    expect(() => replaceProjectPublicContactInputSchema.parse({ ...base, internalNote: "secret" })).toThrow();
    expect(() => replaceProjectPublicContactInputSchema.parse({ ...base, phone: "" })).toThrow();
    expect(() => replaceProjectPublicContactInputSchema.parse({ ...base, email: "invalid" })).toThrow();
    expect(() => replaceProjectPublicContactInputSchema.parse({ ...base, messengers: ["javascript:alert(1)"] })).toThrow();
  });

  it("keeps the contact form in each Platform Admin project card", () => {
    const source = readFileSync("src/app/admin/_components/ProjectAdminForms.tsx", "utf8");
    for (const label of ["Публичный контакт", "Телефон", "Email", "Публичный адрес", "Мессенджеры", "Часы работы", "Сохранить контакт"]) {
      expect(source).toContain(label);
    }
    expect(source).toContain("Единственный fallback-контакт агентства");
  });
});
