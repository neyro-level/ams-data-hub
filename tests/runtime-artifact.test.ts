import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("runtime artifact template", () => {
  it("builds separate web, worker and migrator targets", async () => {
    const dockerfile = await readFile("Dockerfile", "utf8");
    expect(dockerfile).toContain("AS runtime-web");
    expect(dockerfile).toContain("AS runtime-worker");
    expect(dockerfile).toContain("AS migrator");
    expect(dockerfile).not.toContain("src/worker/main.ts");
    expect(dockerfile).not.toContain("tsx/dist/cli");
  });

  it("hardens services and keeps database identities separate", async () => {
    const compose = await readFile("docker-compose.production.yml", "utf8");
    const deploy = await readFile("scripts/deploy-production.mjs", "utf8");
    expect(compose).toContain("read_only: true");
    expect(compose).toContain("no-new-privileges:true");
    expect(compose).toContain("/etc/ams-data-hub/web.env");
    expect(compose).toContain("/etc/ams-data-hub/worker.env");
    expect(compose).toContain("/etc/ams-data-hub/migrator.env");
    expect(compose).toContain("/opt/ams-data-hub/shared/release.env");
    expect(compose).toContain("AMS_DATA_HUB_WEB_IMAGE");
    expect(compose).toContain("AMS_DATA_HUB_WORKER_IMAGE");
    expect(compose).toContain("AMS_DATA_HUB_MIGRATOR_IMAGE");
    expect(deploy).toContain("--read-only");
    expect(deploy).toContain("--tmpfs /tmp:rw,noexec,nosuid,nodev,size=64m");
    expect(deploy).toContain("--cap-drop ALL");
    expect(deploy).toContain("--security-opt no-new-privileges:true");
    expect(deploy).toContain("registry-manifest.json");
    expect(deploy).toContain("pkg.sourcecraft.tech/cr/integrator-p/");
    expect(deploy).toContain("SOURCECRAFT_REGISTRY_PULL_PAT");
    expect(deploy).not.toContain("docker build");
    expect(deploy).not.toContain("docker load");
  });

  it("keeps live proof local and cache/access aware", async () => {
    const proof = await readFile("ops/release/live-proof.sh", "utf8");
    expect(proof).toContain("http://127.0.0.1:3000");
    expect(proof).toContain("cache-control:.*no-store");
    expect(proof).toContain("/dashboard");
    expect(proof).toContain("/admin");
  });
});
