import { createUlid } from "@ams-data-hub/data-contracts";
import { describe, expect, it } from "vitest";
import {
  projectEditorialPublicDtoSchema,
  replaceEntityEditorialInputSchema,
  replaceEntityMediaOrderPolicyInputSchema,
} from "../src/modules/project-state/index.ts";
import { mapProjectEditorialPublic } from "../src/modules/project-state/application/project-editorial-mapper.ts";

const entityUid = createUlid();
const key = { organizationId: "organization-1", projectId: "project-1", entityType: "INVENTORY" as const, entityUid };

describe("project editorial contract", () => {
  it("accepts bounded plain editorial and rejects raw HTML, long-form and duplicate media", () => {
    const valid = {
      ...key,
      version: 0,
      shortDescription: "Короткое описание",
      description: "Публичное описание без разметки",
      faq: [{ question: "Вопрос?", answer: "Ответ." }],
      presentationNotes: "Внутренняя заметка",
      mediaOrder: ["media-a", "media-b"],
    };
    expect(replaceEntityEditorialInputSchema.parse(valid)).toMatchObject(valid);
    expect(() => replaceEntityEditorialInputSchema.parse({ ...valid, description: "<script>alert(1)</script>" })).toThrow();
    expect(() => replaceEntityEditorialInputSchema.parse({ ...valid, description: "x".repeat(4001) })).toThrow();
    expect(() => replaceEntityEditorialInputSchema.parse({ ...valid, mediaOrder: ["media-a", "media-a"] })).toThrow();
    expect(() => replaceEntityEditorialInputSchema.parse({ ...valid, seoTitle: "forbidden" })).toThrow();
    expect(() => replaceEntityMediaOrderPolicyInputSchema.parse({ ...key, version: 0, sourceMediaOrder: ["media-a", "media-a"], isImageOrderChangeAllowed: true })).toThrow();
  });

  it("maps only public fields and preserves source order when override policy is stale", () => {
    const editorial = {
      ...key,
      shortDescription: "Коротко",
      description: "Описание",
      faq: [{ question: "Q", answer: "A" }],
      presentationNotes: "private operational note",
      mediaOrder: ["media-b", "media-a"],
      mediaOrderPolicyVersion: 1,
      version: 2,
    };
    const policy = { ...key, sourceMediaOrder: ["media-a", "media-b"], isImageOrderChangeAllowed: true, version: 2 };
    const mapped = mapProjectEditorialPublic(editorial, policy);
    expect(mapped.mediaOrder).toEqual(["media-a", "media-b"]);
    expect(Object.keys(mapped).sort()).toEqual(["description", "entityType", "entityUid", "faq", "isImageOrderChangeAllowed", "mediaOrder", "shortDescription"]);
    expect(JSON.stringify(mapped)).not.toContain("private operational note");
    expect(projectEditorialPublicDtoSchema.parse(mapped)).toEqual(mapped);
  });
});
