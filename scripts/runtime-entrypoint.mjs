import { spawn } from "node:child_process";
import { validateRuntimeEnvironment } from "./runtime-environment.mjs";

const [role, entrypoint, ...commandArgs] = process.argv.slice(2);
if (!role || !entrypoint) {
  throw new Error("Runtime entrypoint requires a role and a Node entrypoint");
}

validateRuntimeEnvironment(role, commandArgs, process.env);
process.stdout.write(`runtime_environment=valid role=${role}\n`);

const nodeArguments = role === "worker"
  ? ["--conditions=react-server", entrypoint, ...commandArgs]
  : [entrypoint, ...commandArgs];
const child = spawn(process.execPath, nodeArguments, {
  env: process.env,
  stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => child.kill(signal));
}

child.once("error", (error) => {
  throw error;
});
child.once("exit", (code, signal) => {
  process.exit(code ?? (signal ? 128 : 1));
});
