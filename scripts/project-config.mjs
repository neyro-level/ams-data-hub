import { access, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const timezonePattern = /^[+-](0\d|1[0-4]):[0-5]\d$/;
const httpsUrlSchema = z
  .string()
  .url()
  .refine((value) => value.startsWith("https://"), "URL должен начинаться с https://");

const projectInputSchema = z.object({
  projectName: z.string().trim().min(2, "Укажите название проекта"),
  projectSlug: z.string().trim().regex(slugPattern, "Slug: lowercase latin, digits and hyphens"),
  siteName: z.string().trim().min(2, "Укажите название сайта"),
  siteSlug: z.string().trim().regex(slugPattern, "Site slug: lowercase latin, digits and hyphens"),
  siteUrl: httpsUrlSchema,
  timezone: z.string().trim().regex(timezonePattern, "Timezone должен иметь формат +03:00"),
  clusterProfile: z.string().trim().regex(slugPattern),
  webmasterHostUrl: z.union([httpsUrlSchema, z.literal("")]).transform((value) => value || null),
  metricaCounterId: z
    .union([z.string().trim().regex(/^\d+$/, "Metrica counter ID должен содержать только цифры"), z.literal("")])
    .transform((value) => value || null),
});

export function buildProjectConfig(input) {
  const parsed = projectInputSchema.parse({
    ...input,
    timezone: input.timezone ?? "+03:00",
    clusterProfile: input.clusterProfile ?? "default",
    webmasterHostUrl: input.webmasterHostUrl ?? "",
    metricaCounterId: input.metricaCounterId ?? "",
  });

  return {
    project: {
      schemaVersion: 1,
      clientSlug: parsed.projectSlug,
      name: parsed.projectName,
      enabled: true,
      clusterProfile: parsed.clusterProfile,
      sites: [
        {
          siteSlug: parsed.siteSlug,
          name: parsed.siteName,
          siteUrl: parsed.siteUrl,
          timezone: parsed.timezone,
          enabled: true,
          webmaster: {
            enabled: parsed.webmasterHostUrl !== null,
            expectedHostUrl: parsed.webmasterHostUrl,
          },
          metrica: {
            enabled: parsed.metricaCounterId !== null,
            counterId: parsed.metricaCounterId,
            goalProfile: parsed.projectSlug,
          },
        },
      ],
    },
    goals: {
      schemaVersion: 1,
      clientSlug: parsed.projectSlug,
      goals: [],
    },
  };
}

export async function writeProjectConfig({ rootDir, input, dryRun = false }) {
  const payload = buildProjectConfig(input);
  const clusterPath = path.join(
    rootDir,
    "clusters",
    `${payload.project.clusterProfile}.json`,
  );

  await access(clusterPath).catch(() => {
    throw new Error(`Неизвестный cluster profile: ${payload.project.clusterProfile}`);
  });

  const projectPath = path.join(
    rootDir,
    "clients",
    `${payload.project.clientSlug}.json`,
  );
  const goalsPath = path.join(
    rootDir,
    "goals",
    `${payload.project.clientSlug}.json`,
  );
  const existing = await Promise.all(
    [projectPath, goalsPath].map((filePath) =>
      access(filePath).then(
        () => filePath,
        () => null,
      ),
    ),
  );

  if (existing.some((filePath) => filePath !== null)) {
    throw new Error(`Проект ${payload.project.clientSlug} уже существует; перезапись запрещена`);
  }

  const clientsDir = path.join(rootDir, "clients");
  const clientEntries = await readdir(clientsDir).catch(() => []);
  const requestedSiteUrl = new URL(payload.project.sites[0].siteUrl);
  const requestedSitePath =
    requestedSiteUrl.pathname === "/" ? "" : requestedSiteUrl.pathname.replace(/\/$/, "");
  const requestedNormalizedUrl =
    `${requestedSiteUrl.protocol.toLowerCase()}//${requestedSiteUrl.hostname.toLowerCase()}${requestedSitePath}`;

  for (const entry of clientEntries.filter((name) => name.endsWith(".json"))) {
    const existingProject = JSON.parse(
      await readFile(path.join(clientsDir, entry), "utf8"),
    );
    for (const site of existingProject.sites ?? []) {
      const existingSiteUrl = new URL(site.siteUrl);
      const existingSitePath =
        existingSiteUrl.pathname === "/"
          ? ""
          : existingSiteUrl.pathname.replace(/\/$/, "");
      const existingNormalizedUrl =
        `${existingSiteUrl.protocol.toLowerCase()}//${existingSiteUrl.hostname.toLowerCase()}${existingSitePath}`;
      if (existingNormalizedUrl === requestedNormalizedUrl) {
        throw new Error(`Сайт ${payload.project.sites[0].siteUrl} уже принадлежит проекту ${existingProject.name}`);
      }
    }
  }

  const result = { payload, projectPath, goalsPath };
  if (dryRun) {
    return result;
  }

  await mkdir(path.dirname(projectPath), { recursive: true });
  await mkdir(path.dirname(goalsPath), { recursive: true });

  const suffix = `${process.pid}-${Date.now()}.tmp`;
  const projectTempPath = `${projectPath}.${suffix}`;
  const goalsTempPath = `${goalsPath}.${suffix}`;

  try {
    await writeFile(projectTempPath, `${JSON.stringify(payload.project, null, 2)}\n`, "utf8");
    await writeFile(goalsTempPath, `${JSON.stringify(payload.goals, null, 2)}\n`, "utf8");
    await rename(projectTempPath, projectPath);
    await rename(goalsTempPath, goalsPath);
  } catch (error) {
    await Promise.all([
      rm(projectTempPath, { force: true }),
      rm(goalsTempPath, { force: true }),
      rm(projectPath, { force: true }),
      rm(goalsPath, { force: true }),
    ]);
    throw error;
  }

  return result;
}

export async function removeProjectConfig({ projectPath, goalsPath }) {
  await Promise.all([
    rm(projectPath, { force: true }),
    rm(goalsPath, { force: true }),
  ]);
}

export async function readProjectConfig(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}
