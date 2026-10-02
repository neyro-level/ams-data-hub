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

if (process.argv.length > 2) {
  throw new Error("The migrator image accepts no arbitrary command.");
}

await run(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"]);
await run(process.execPath, ["scripts/pgboss-migrate.mjs"]);
