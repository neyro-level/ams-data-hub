# Local Development

Canonical local mode: Windows-native checkout and Windows-native PostgreSQL.

Suggested local names:

- database: `ams_start_dev`;
- test database: `ams_start_test`;
- local role: `ams_start_local`;
- test role: `ams_start_test`.

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
