# Design System — АМС Старт

**Статус:** Active

The starter has two intentionally separate but compatible visual surfaces:

- public commercial shell: dark premium theme, wordmark, legal pages, footer
  and login modal;
- private application shell: navigation, compact headers, tables, forms and
  explicit loading/empty/error states.

Components use semantic tokens and reusable patterns; product-specific class
names, raw brand colors and real legal/contact data do not belong to the
baseline. Private data must never enter service-worker caches.

`EXTERNAL_SITE_DESIGN_SYSTEM.md` and `INTERNAL_DASHBOARD_DESIGN_SYSTEM.md`
remain detailed surface specifications. This file decides cross-surface rules;
the detailed files cannot introduce a competing product identity.
