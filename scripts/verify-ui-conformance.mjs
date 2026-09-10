import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();

async function filesUnder(relativeDirectory) {
  const directory = path.join(root, relativeDirectory);
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => entry.isDirectory() ? filesUnder(path.join(relativeDirectory, entry.name)) : [path.join(relativeDirectory, entry.name)]));
  return nested.flat();
}

const violations = [];
const trackedUiFiles = [...await filesUnder("src"), ...await filesUnder("docs")].filter((file) => /\.(?:css|md|ts|tsx)$/.test(file));
for (const file of trackedUiFiles) {
  const source = await readFile(path.join(root, file), "utf8");
  if (/--crm-|var\(--crm-/.test(source)) violations.push(`${file}: legacy crm token`);
  if (/--radius-control|var\(--radius-control\)/.test(source)) violations.push(`${file}: obsolete radius-control token`);
  if (/(?:text-\[(?:color:)?var|\[color:var)\(--(?!ch-)/.test(source)) violations.push(`${file}: private text color must use a stable semantic text utility`);
  if (/Application Design System 2\.0|UI Development Constitution 1\.0/.test(source)) violations.push(`${file}: obsolete UI canon version`);
  if (/(?:text-\[(?:color:)?var|\[color:var)\(--(?!ch-)/.test(source)) violations.push(`${file}: private text color must use a stable semantic text utility`);
}

const reusableComponents = (await filesUnder("src/components"))
  .filter((file) => /\.(?:css|tsx)$/.test(file));
for (const file of reusableComponents) {
  const source = await readFile(path.join(root, file), "utf8");
  if (/#[0-9a-f]{3,8}\b|rgba?\(/i.test(source)) violations.push(`${file}: system color must use a semantic token`);
  if (/(?:text|bg|border|ring|fill|stroke)-(?:white|black|slate|gray|zinc|neutral|stone|red|rose|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink)(?:\b|\/|\[)/.test(source)) violations.push(`${file}: Tailwind palette color must use a semantic token`);
  if (/rounded-(?:sm|md|lg|xl|2xl|3xl)|rounded-\[[0-9]+px\]/.test(source)) violations.push(`${file}: system radius must use a canonical radius token`);
  const normalized = file.replaceAll("\\", "/");
  if (normalized.includes("/components/ui/") && /--ch-/.test(source)) violations.push(`${file}: generic primitive depends on public brand tokens`);

  for (const match of source.matchAll(/<Button\b[\s\S]{0,500}?\bsize=["']icon["'][\s\S]{0,500}?>/g)) {
    if (!/aria-label=|aria-labelledby=/.test(match[0])) violations.push(`${file}: icon-only Button needs an accessible name`);
  }
}

for (const relativeDirectory of ["src/app/admin", "src/app/analyst", "src/app/dashboard", "src/app/c", "src/app/demo"]) {
  for (const file of (await filesUnder(relativeDirectory)).filter((item) => /\.tsx$/.test(item))) {
    const source = await readFile(path.join(root, file), "utf8");
    if (/(?:text|bg|border|ring|fill|stroke)-(?:white|black|slate|gray|zinc|neutral|stone|red|rose|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink)(?:\b|\/|\[)/.test(source)) violations.push(`${file}: private UI palette color must use a semantic token`);
    if (/rounded-(?:sm|md|lg|xl|2xl|3xl)|rounded-\[[0-9]+px\]/.test(source)) violations.push(`${file}: private UI radius must use a canonical radius token`);
  }
}

const legacySelect = path.join(root, "src/components/ui/select.tsx");
try {
  await readFile(legacySelect, "utf8");
  violations.push("src/components/ui/select.tsx: native control must use the NativeSelect contract");
} catch (error) {
  if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
}

const globals = await readFile(path.join(root, "src/app/globals.css"), "utf8");
for (const marker of [".impulse-grid", ".impulse-atmosphere", ".impulse-visual", ".legal-prose", ".legal-source-content"]) {
  if (globals.includes(marker)) violations.push(`src/app/globals.css: business selector ${marker}`);
}

if (violations.length > 0) {
  console.error(`UI conformance failed:\n${violations.map((item) => `- ${item}`).join("\n")}`);
  process.exit(1);
}

console.log("UI conformance: Constitution 3.1 tokens, primitives, accessibility and global CSS boundaries are clean.");
