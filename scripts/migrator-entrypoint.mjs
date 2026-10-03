import { spawn } from "node:child_process";

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", env: process.env });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error(`${command} exited by signal ${signal}`));
      else if (code !== 0) reject(new Error(`${command} exited with code ${code}`));
      else resolve();
    });
  });
}

const command = process.argv[2] ?? "migrate";
if (!["migrate", "bootstrap-roles"].includes(command) || process.argv.length > 3) {
  throw new Error("The migrator image accepts only migrate or bootstrap-roles.");
}

if (command === "bootstrap-roles") {
  await run(process.execPath, ["scripts/db-bootstrap-roles.mjs"]);
} else {
  await run(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"]);
  await run(process.execPath, ["scripts/pgboss-migrate.mjs"]);
}
