# Recovery

**Status:** Active extension. A derived product must add its own data and
integration recovery contract before production.

Starter-level recovery checklist:

1. confirm exact commit SHA and branch;
2. confirm database target is not unknown;
3. check `/api/health/live`;
4. check `/api/health/ready`;
5. confirm worker heartbeat and outbox health;
6. restore from latest verified PostgreSQL backup if data corruption is confirmed;
7. rotate affected secrets outside Git.

Derived products must add their own integration and business-data recovery steps.
