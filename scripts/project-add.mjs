import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { removeProjectConfig, writeProjectConfig } from "./project-config.mjs";

const { values } = parseArgs({
  options: {
    "project-name": { type: "string" },
    "project-slug": { type: "string" },
    "site-name": { type: "string" },
    "site-slug": { type: "string" },
    "site-url": { type: "string" },
    timezone: { type: "string", default: "+03:00" },
    "cluster-profile": { type: "string", default: "default" },
    "webmaster-host": { type: "string" },
    "metrica-counter": { type: "string" },
    source: { type: "string" },
    "dry-run": { type: "boolean", default: false },
    yes: { type: "boolean", short: "y", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
  allowPositionals: false,
});

if (values.help) {
  process.stdout.write(`AMS SEO Monitor project wizard

Interactive:
  pnpm project:add -- --source C:\\private\\ams-impulse-config

Non-interactive preview:
  pnpm project:add --project-name "Example" --project-slug example \\
    --site-name "Moscow" --site-slug moscow --site-url https://example.ru \\
    --source C:\\private\\ams-impulse-config --dry-run --yes

Rules:
  - never writes secrets;
  - never overwrites an existing project;
  - never commits, pushes or deploys;
  - removes generated files when registry validation fails.
`);
  process.exit(0);
}

const requiredOptions = [
  "source",
  "project-name",
  "project-slug",
  "site-name",
  "site-slug",
  "site-url",
];
const missingRequired = requiredOptions.filter((name) => !values[name]);
const needsPrompt = missingRequired.length > 0;

if (needsPrompt && (!process.stdin.isTTY || !process.stdout.isTTY)) {
  throw new Error(`Не хватает параметров: ${missingRequired.join(", ")}`);
}

const terminal = needsPrompt || !values.yes
  ? createInterface({ input: process.stdin, output: process.stdout })
  : null;

async function ask(optionName, label, fallback = "") {
  const existingValue = values[optionName];
  if (typeof existingValue === "string" && existingValue.trim().length > 0) {
    return existingValue.trim();
  }

  if (!terminal) {
    return fallback;
  }

  const suffix = fallback ? ` [${fallback}]` : "";
  const answer = (await terminal.question(`${label}${suffix}: `)).trim();
  return answer || fallback;
}

try {
  const rootDir = path.resolve(await ask("source", "Private config directory"));
  const input = {
    projectName: await ask("project-name", "Название проекта"),
    projectSlug: await ask("project-slug", "Slug проекта (latin lowercase)"),
    siteName: await ask("site-name", "Название первого сайта/города"),
    siteSlug: await ask("site-slug", "Slug сайта"),
    siteUrl: await ask("site-url", "Production URL сайта"),
    timezone: await ask("timezone", "Timezone", "+03:00"),
    clusterProfile: await ask("cluster-profile", "Cluster profile", "default"),
    webmasterHostUrl: await ask(
      "webmaster-host",
      "Webmaster host URL; Enter — подключить позже",
      "",
    ),
    metricaCounterId: await ask(
      "metrica-counter",
      "Metrica counter ID; Enter — подключить позже",
      "",
    ),
  };

  const preview = await writeProjectConfig({ rootDir, input, dryRun: true });

  process.stdout.write(`\nБудут созданы:\n- ${path.relative(rootDir, preview.projectPath)}\n- ${path.relative(rootDir, preview.goalsPath)}\n\n`);
  process.stdout.write(`${JSON.stringify(preview.payload, null, 2)}\n`);

  if (values["dry-run"]) {
    process.stdout.write("\nDry-run: файлы не изменены.\n");
    process.exit(0);
  }

  if (!values.yes) {
    const confirmation = (await terminal.question("\nСоздать проект? [y/N]: "))
      .trim()
      .toLowerCase();
    if (confirmation !== "y" && confirmation !== "yes") {
      process.stdout.write("Отменено.\n");
      process.exit(0);
    }
  }

  const written = await writeProjectConfig({ rootDir, input });
  const verification = spawnSync(process.execPath, [path.join(process.cwd(), "scripts", "verify-config.mjs"), "--source", rootDir], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  if (verification.status !== 0) {
    await removeProjectConfig(written);
    const diagnostic = [verification.stdout, verification.stderr].filter(Boolean).join("\n").trim();
    throw new Error(`Registry validation failed; generated files removed.\n${diagnostic}`);
  }

  process.stdout.write(`\n${verification.stdout.trim()}\n`);
  process.stdout.write(`Проект ${written.payload.project.name} создан локально.\n`);
  process.stdout.write("Дальше: проверить config diff, настроить Doppler/Yandex доступы и выполнить build.\n");
} finally {
  terminal?.close();
}
