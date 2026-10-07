import { describe, expect, it } from "vitest";
import { createPgPoolConfig, createPgPoolConfigFromEnvironment } from "../src/platform/database/prisma/pool-config.ts";

describe("Prisma PostgreSQL session timezone", () => {
  it("pins URL-configured sessions to UTC without changing connection identity", () => {
    const config = createPgPoolConfig("postgresql://synthetic:synthetic@127.0.0.1:5435/ams_data_hub_test?sslmode=disable&options=ignored");
    expect(config).toMatchObject({ host: "127.0.0.1", port: 5435, database: "ams_data_hub_test",
      ssl: false, options: "-c timezone=UTC" });
  });

  it("pins component-configured sessions to the same UTC contract", () => {
    const config = createPgPoolConfigFromEnvironment({ APP_ENV: "test", NODE_ENV: "test",
      DATABASE_HOST: "127.0.0.1", DATABASE_PORT: "5435", DATABASE_USER: "ams_data_hub_test",
      DATABASE_PASSWORD: "synthetic", DATABASE_NAME: "ams_data_hub_test", DATABASE_SSLMODE: "disable" });
    expect(config).toMatchObject({ host: "127.0.0.1", port: 5435, database: "ams_data_hub_test",
      ssl: false, options: "-c timezone=UTC" });
  });
});
