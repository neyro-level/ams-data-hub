# PLATFORM CONFORMANCE

Core: `AMS Application Platform Core 3.4 — Solo Minimal`
Reviewed: `2026-09-07`
Profile: `multi-tenant / outbox-plus-queue / pii / own-saas / Platform Admin enabled / self-managed PostgreSQL`.

| Guarantee | State | Evidence / gap |
|---|---|---|
| Project profile and minimal docs canon | IMPLEMENTED | README, AGENTS, ARCHITECTURE, ADR-001, ENVIRONMENT |
| Modular monolith and import boundaries | IMPLEMENTED | module entrypoints, Dependency Cruiser, bounded admin adapters |
| PostgreSQL/Prisma source of truth | IMPLEMENTED | Prisma 7 schema, immutable migrations, repository boundaries |
| Self-managed PostgreSQL 18 | APPROVED_PROJECT_EXCEPTION | ADR-001; loopback listener, roles, capacity, backup/restore checked before release |
| Managed PostgreSQL | NOT_APPLICABLE | no migration target or backlog |
| TypeScript 6.0.3 | APPROVED_PROJECT_EXCEPTION | exact package/lockfile version in ADR-001 |
| Username/password authentication | IMPLEMENTED | admin-assigned exact 8-character password, closed signup, fresh session/active-user boundary |
| Additional auth factor | APPROVED_PROJECT_EXCEPTION | owner chose simple password access; HTTPS, rate limit, session revocation, disabled-user boundary and audit remain |
| PrincipalContext authorization | IMPLEMENTED | private reads/actions use discriminated principal; legacy facade is forbidden |
| Multi-tenant ownership and constraints | IMPLEMENTED | tenant registry, scoped repositories, composite constraints, isolation tests |
| Admin client provisioning | IMPLEMENTED | one atomic Organization→Project→User credential→Membership→AuditEvent command |
| `defineAction → defineCommand` mutations | IMPLEMENTED | centralized action boundary and transaction-owned commands |
| Async outbox + pg-boss | IMPLEMENTED | deterministic dispatch, idempotency, lease, bounded retry/dead-letter |
| Worker heartbeat/readiness | IMPLEMENTED | RuntimeHeartbeat is worker-liveness source |
| Seed/config boundary | IMPLEMENTED | safe bootstrap, private-path dry-run/apply, no deployment import |
| Environment validation | IMPLEMENTED | explicit DB target, isolated identities, safe target summary |
| Provider integrations | PARTIAL | Webmaster and Metrika fresh on configured sites; one proven Topvisor mapping enabled with current positions, three unmapped connections remain disabled |
| UI Constitution 3.1 / Design System 2.1 | IMPLEMENTED | project profile preserves the AMS IMPULSE palette as an isolated override; old token/version aliases are rejected by the UI verifier |
| shadcn UI foundation | IMPLEMENTED | Base UI primitives wrap public/private controls; NativeSelect and Accordion replace manual native/disclosure styling; public/app themes are isolated |
| Application shell | IMPLEMENTED | shared private layout, server-built navigation, desktop 232/72 sidebar, desktop/mobile topbar and drawer; user name and understandable role are visible |
| Tables and charts | IMPLEMENTED | shared server-driven AdminDataTable + mobile cards; TanStack Table 9.2.4; tokenized shadcn Chart + Recharts with explicit period, units and timezone |
| SourceCraft verification | IMPLEMENTED | quick PR check; exact risky/release workflows; nightly daily |
| SourceCraft secret scanning | REQUIRES_CHECK | platform-side enablement not independently confirmed |
| Immutable image release and rollback | IMPLEMENTED | exact SHA/digest, single web/worker image, rollback contract |
| Backup/offsite/restore | IMPLEMENTED | release gate requires checksum, offsite confirmation and isolated restore smoke |
| PII/log redaction | IMPLEMENTED | nested redaction and serialized-log sentinel test |
| Repository client-data sanitation | IMPLEMENTED | only synthetic examples/fixtures; signature verifier |
| GitHub public mirror sanitation | REQUIRES_CHECK | mirror stays private while an old pre-rewrite SHA remains accessible |
| DateTime native-type proof | PARTIAL | 81 fields mapped: 17 UTC instants, 6 civil timestamps, 58 require proof |
| Obsolete auth compatibility schema | IMPLEMENTED | runtime removed first; following immutable migration removes proven-unused tables/flags |
| Production DB least privilege | PARTIAL | runtime has no DDL; migrator `CREATEDB` narrowing remains `REQUIRES_CHECK` |

Этот файл хранит устойчивый conformance state, а не историю релизов. Exact production SHA/digest и live proof принадлежат release evidence.
