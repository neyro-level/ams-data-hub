# AMS Data Hub Application Design System

**Status:** Active extension. `06_DESIGN_SYSTEM.md` owns cross-surface design
policy; this file defines the private application-surface detail.

Private UI is optimized for CRM, analytics and internal operations:

- predictable left navigation;
- compact headers and cards;
- tables and forms for repeated admin work;
- semantic tokens instead of business CSS;
- responsive shell with mobile drawer;
- clear empty/error/loading states.

Private routes:

- `/dashboard/`;
- `/admin/*`;
- `/notifications/`.

Reusable UI must avoid product-specific class names and raw colors.
