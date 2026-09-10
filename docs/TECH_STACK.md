# TECH STACK

Таблица ниже описывает фактический runtime canonical `main` по `package.json`, lockfile, `.node-version` и release assets. Platform contract — Application Platform Core 3.4; TypeScript `6.0.3` зафиксирован как project exception в ADR-001.

## Source of truth

`package.json` и `pnpm-lock.yaml` определяют фактические package versions. Floating versions запрещены.

## Runtime

| Слой | Версия / выбор | Назначение |
|---|---|---|
| Node.js | `>=24.20.0 <25` | web, worker, scripts |
| pnpm | `11.5.1` | reproducible install |
| Next.js | `16.3.3` | App Router standalone server |
| React / React DOM | `19.2.8` | UI |
| TypeScript | `6.0.3` | strict ESM application/worker types |
| Zod | `4.5.4` | DTO/config validation |
| Prisma / `@prisma/client` | `7.10.0` / `7.10.0` | explicit generated client, schema, migrations, repositories |
| PostgreSQL | `18.x` | runtime source of truth |
| Better Auth | `1.7.2` | identity/password/session; Organization Plugin и public signup выключены |
| Base UI / shadcn | `1.8.0` / project-owned components | accessible UI primitives и переносимая visual оболочка |
| TanStack Table | `9.2.4` | headless table state для private UI |
| pg / Prisma pg adapter | `8.23.0` / `7.10.0` | PostgreSQL transport |
| Tailwind CSS | `4.3.3` | styles |
| Recharts | `3.10.1` | report charts |
| Lucide React | `1.37.0` | icons |
| Vitest | `4.1.11` | unit/real-PostgreSQL integration tests |
| Playwright | `1.62.1` | production-like E2E and responsive contracts |
| Dependency Cruiser | `18.2.0` | executable import boundaries |

## Build contract

- `next.config.ts`: `output: "standalone"`, `poweredByHeader: false`;
- `.node-version`: exact `24.20.0` для local/CI/release parity;
- `pnpm build`: Prisma generate → config verification → Next build → standalone asset assembly;
- `scripts/prepare-standalone.mjs` copies `public/` and `.next/static/` into `.next/standalone`;
- `pnpm build:collector`: Prisma generate + `tsconfig.collector.json`;
- `package.json`: `"type": "module"`; all local TypeScript imports use source `.ts` extensions and collector emit rewrites them to `.js`;
- Prisma generator: `prisma-client`, explicit `src/generated/prisma` output, ESM and generated `.ts` import extensions;
- generated Prisma client is ignored and recreated by `pnpm prisma:generate`; it is never edited manually;
- Linux release installs dependencies strictly from lockfile before build.

## Version policy

- exact package pins;
- no beta/rc/canary/nightly in production baseline;
- Next/React/TypeScript/Prisma/Better Auth major changes are separate architecture work;
- package and lockfile always change together;
- compatibility is proven by typecheck, lint, tests, build and affected runtime smoke;
- production Node version must satisfy `scripts/verify-release-runtime.mjs`.

## Active stack decisions

- UI implementation follows AMS UI Development Constitution `3.1` and Application Design System `2.1`; the established AMS IMPULSE palette is an approved isolated project-theme override;
- все public/private controls используют project-owned shadcn primitives; public `ch-*` изолированы в `theme-public`, private UI использует единый semantic token layer;
- native HTML selects use the shadcn `NativeSelect` wrapper; popup Select is added only for an interaction that needs it; disclosure sections use the Base UI/shadcn Accordion primitive;
- private admin surfaces use React Hook Form, TanStack Table `9.2.4`, shadcn Table и `nuqs`;
- report visualization uses shadcn Chart wrappers over Recharts;
- Platform Admin uses typed route composition and shared primitives; Refine отсутствует;
- pg-boss `12.30.0` has a separate schema/pool/migration contract;
- pino `10.3.1` uses redaction and correlation-aware callsites;
- Sentry remains disabled until SECURITY records a compliant DSN/proof path;
- Docker release assets are versioned; фактическое production state требует отдельного operational proof.

Пустые platform dependencies без callsites запрещены.

## Deliberate exclusions

Текущему продукту не нужны второй ORM/backend/auth, Redis, ClickHouse, TimescaleDB или Kubernetes. Новые dependencies требуют доказанного contract gap или ADR.
