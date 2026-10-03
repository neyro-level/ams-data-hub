# Design System — AMS Data Hub

**Статус:** Active

## Общие правила

- Project-owned components use semantic tokens, not raw brand colors.
- Reuse → variant → create; product-specific class names are forbidden.
- Loading, empty, error, disabled and permission-denied states are explicit.
- Private data never enters service-worker or public caches.
- Responsive controls keep a minimum practical touch target and visible focus.

## Public surface

- Dark premium shell and compact `AMS DATA HUB` wordmark.
- Login and legal content share one public visual language.
- Footer contains only approved operator/legal information.
- No marketing landing blocks are introduced by the design system.

## Private application surface

- Predictable left navigation, compact headers/cards, data tables and forms.
- Responsive shell uses a mobile drawer and preserves keyboard navigation.
- Admin workflows prioritize scanability, status clarity and repeated work.
- Private routes include workspace, Platform Admin and notifications only when
  enabled by the product contract.

This document consolidates the former external/private design-system notes
without changing runtime visuals.
