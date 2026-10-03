import { describe, expect, it, vi } from "vitest";
import {
  bootstrapDatabaseRoles,
  readRolePasswords,
  runtimeDatabaseRoles,
  validateBootstrapTarget,
} from "../scripts/db-bootstrap-roles.mjs";

const passwords = {
  ams_data_hub_web: "web-".padEnd(40, "w"),
  ams_data_hub_worker: "worker-".padEnd(40, "k"),
  ams_data_hub_backup: "backup-".padEnd(40, "b"),
};

describe("database role bootstrap", () => {
  it("accepts complete env or JSON stdin without exposing values in errors", () => {
    expect(
      readRolePasswords({
        AMS_DATA_HUB_WEB_DB_PASSWORD: passwords.ams_data_hub_web,
        AMS_DATA_HUB_WORKER_DB_PASSWORD: passwords.ams_data_hub_worker,
        AMS_DATA_HUB_BACKUP_DB_PASSWORD: passwords.ams_data_hub_backup,
      }),
    ).toEqual(passwords);
    expect(readRolePasswords({}, JSON.stringify(passwords))).toEqual(passwords);
    expect(() =>
      readRolePasswords({ AMS_DATA_HUB_WEB_DB_PASSWORD: passwords.ams_data_hub_web }),
    ).toThrow("supplied together");
  });

  it("requires an exact PostgreSQL database target", () => {
    expect(
      validateBootstrapTarget(
        "postgresql://operator:secret@database.internal:5432/ams_data_hub",
        "ams_data_hub",
      ),
    ).toEqual({ database: "ams_data_hub" });
    expect(() =>
      validateBootstrapTarget(
        "postgresql://operator:secret@database.internal:5432/other",
        "ams_data_hub",
      ),
    ).toThrow("does not match");
  });

  it("passes passwords only as bound values and verifies least-privilege roles", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("rolsuper, r.rolcreaterole")) {
        return { rows: [{ rolsuper: false, rolcreaterole: true }] };
      }
      if (sql.includes("WHERE rolname = ANY")) {
        return {
          rows: [...runtimeDatabaseRoles].sort().map((rolname) => ({
            rolname,
            rolcanlogin: true,
            rolsuper: false,
            rolcreaterole: false,
            rolcreatedb: false,
            rolreplication: false,
            rolbypassrls: false,
          })),
        };
      }
      return { rows: [] };
    });

    await expect(bootstrapDatabaseRoles({ query }, passwords)).resolves.toEqual(
      [...runtimeDatabaseRoles].sort(),
    );
    const sqlTexts = query.mock.calls.map(([sql]) => sql).join("\n");
    for (const password of Object.values(passwords)) {
      expect(sqlTexts).not.toContain(password);
    }
    expect(query).toHaveBeenCalledWith(
      "SELECT set_config('ams.bootstrap.web_password', $1, true)",
      [passwords.ams_data_hub_web],
    );
    expect(sqlTexts).toContain("NOBYPASSRLS");
    expect(sqlTexts).toContain("COMMIT");
  });
});
