import { cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nextDir = path.join(rootDir, ".next");
const standaloneDir = path.join(nextDir, "standalone");

await mkdir(path.join(standaloneDir, ".next"), { recursive: true });
await cp(path.join(rootDir, "public"), path.join(standaloneDir, "public"), {
  recursive: true,
});
await cp(path.join(nextDir, "static"), path.join(standaloneDir, ".next", "static"), {
  recursive: true,
});
