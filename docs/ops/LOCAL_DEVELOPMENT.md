# Local Development

**Status:** Active extension. Local-runtime procedure detail for the architecture
contract; it does not define production topology.

Canonical local mode: Windows-native checkout and Windows-native PostgreSQL.

Suggested local names:

- database: `ams_data_hub_dev`;
- test database: `ams_data_hub_test`;
- local role: `ams_data_hub_local`;
- test role: `ams_data_hub_test`.

Start:

```bash
pnpm install
pnpm prisma:generate
pnpm dev
```

Optional managed launcher:

```bash
pnpm dev:db:status
pnpm dev:start
```

Local URL: `http://127.0.0.1:3001`. Open `/dashboard/` for private shell after login.
