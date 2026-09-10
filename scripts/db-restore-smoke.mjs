import { execFileSync } from "node:child_process";

const result = execFileSync(
  "ssh",
  ["-o", "BatchMode=yes", "ams", "/usr/local/bin/seo-monitor-db-restore-smoke.sh"],
  {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  },
);

process.stdout.write(result);
