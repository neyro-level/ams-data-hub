import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildProjectConfig,
  readProjectConfig,
  writeProjectConfig,
} from "../scripts/project-config.mjs";

const tempDirs: string[] = [];

async function createProjectRoot() {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "ams-seo-project-"));
  tempDirs.push(rootDir);
  const clustersDir = path.join(rootDir, "clusters");
  await mkdir(clustersDir, { recursive: true });
  await writeFile(
    path.join(clustersDir, "default.json"),
    JSON.stringify({
      schemaVersion: 1,
      profileSlug: "default",
      name: "Default",
      brandTerms: [],
      groups: [],
    }),
    "utf8",
  );
  return rootDir;
}

const baseInput = {
  projectName: "Новый проект",
  projectSlug: "new-project",
  siteName: "Основной сайт",
  siteSlug: "main",
  siteUrl: "https://example.ru",
  timezone: "+03:00",
  clusterProfile: "default",
  webmasterHostUrl: "",
  metricaCounterId: "",
};

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("project config builder", () => {
  it("creates a project with one site and disabled integrations", () => {
    const result = buildProjectConfig(baseInput);

    expect(result.project).toMatchObject({
      clientSlug: "new-project",
      name: "Новый проект",
      sites: [
        {
          siteSlug: "main",
          enabled: true,
          webmaster: { enabled: false, expectedHostUrl: null },
          metrica: { enabled: false, counterId: null, goalProfile: "new-project" },
        },
      ],
    });
    expect(result.goals).toEqual({
      schemaVersion: 1,
      clientSlug: "new-project",
      goals: [],
    });
  });

  it("enables only integrations with confirmed identifiers", () => {
    const result = buildProjectConfig({
      ...baseInput,
      webmasterHostUrl: "https://example.ru",
      metricaCounterId: "12345678",
    });

    expect(result.project.sites[0]?.webmaster.enabled).toBe(true);
    expect(result.project.sites[0]?.metrica.enabled).toBe(true);
  });

  it("does not write files during dry-run", async () => {
    const rootDir = await createProjectRoot();
    const result = await writeProjectConfig({ rootDir, input: baseInput, dryRun: true });

    await expect(readProjectConfig(result.projectPath)).rejects.toThrow();
    await expect(readProjectConfig(result.goalsPath)).rejects.toThrow();
  });

  it("writes both files and refuses overwrite", async () => {
    const rootDir = await createProjectRoot();
    const result = await writeProjectConfig({ rootDir, input: baseInput });

    await expect(readProjectConfig(result.projectPath)).resolves.toMatchObject({
      clientSlug: "new-project",
    });
    await expect(readProjectConfig(result.goalsPath)).resolves.toMatchObject({
      clientSlug: "new-project",
    });
    await expect(writeProjectConfig({ rootDir, input: baseInput })).rejects.toThrow(
      "перезапись запрещена",
    );
  });

  it("rejects an unknown cluster profile before writing", async () => {
    const rootDir = await createProjectRoot();

    await expect(
      writeProjectConfig({
        rootDir,
        input: { ...baseInput, clusterProfile: "missing" },
      }),
    ).rejects.toThrow("Неизвестный cluster profile");
  });

  it("rejects a site URL that already belongs to another project", async () => {
    const rootDir = await createProjectRoot();
    const clientsDir = path.join(rootDir, "clients");
    await mkdir(clientsDir, { recursive: true });
    await writeFile(
      path.join(clientsDir, "existing.json"),
      JSON.stringify({
        schemaVersion: 1,
        clientSlug: "existing",
        name: "Существующий проект",
        enabled: true,
        clusterProfile: "default",
        sites: [{ siteUrl: "https://example.ru/" }],
      }),
      "utf8",
    );

    await expect(writeProjectConfig({ rootDir, input: baseInput })).rejects.toThrow(
      "уже принадлежит проекту Существующий проект",
    );
  });
});
