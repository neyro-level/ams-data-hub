# YRL Vladis/VT24 SourceProfile v1

Status: CALIBRATED
Profile key: `vladis-vt24-v1`
Profile version: `1.0.0`
Adapter: `yrl-realty-2010@1.0.0`

## Source contract

- Source URL: SecretRef only; endpoint and credentials are intentionally redacted.
- Format family: Yandex Realty Language XML.
- Namespace: `http://webmaster.yandex.ru/schemas/feed/realty/2010-06`.
- Dataset type: `MIXED_REALTY`.
- Offer identity: `offer@internal-id`.
- Identity stability: verified on three live test-mode reads on 2026-10-05.
- Required adapter capabilities: streaming XML, XML namespaces, raw attributes.

The adapter stays producer-neutral. Every rule below belongs to this versioned profile.

## Observed mappings

| Source value | Canonical value |
| --- | --- |
| `квартира` | `APARTMENT` |
| `комната` | `ROOM` |
| `house` | `HOUSE` |
| `часть дома` | `HOUSE_PART` |
| `lot` | `LAND` |
| `дача` | `COTTAGE` |
| `таунхаус` | `TOWNHOUSE` |
| `гараж`, `box` | `GARAGE_BOX` |
| `коммерческая` | `COMMERCIAL` |
| `продажа` | `SALE` |
| `аренда` + `день`/`сутки` | `RENT_SHORT` |
| `аренда` + `месяц`/`month`/`год` | `RENT_LONG` |
| `secondary-sale` | `SECONDARY_SALE` |
| `primary-sale` | `PRIMARY_SALE` |
| `assignment` | `ASSIGNMENT` |
| `кв. м` | `M2 × 1` |
| `сотка` | `M2 × 100` |

Unknown categories and transaction semantics produce an import issue; they are not silently accepted. `deal-status` maps to `dealKind` and never replaces `transactionType`.

## Field rules

Sparse source fields are mapped without inventing defaults: `deal-status`, `rooms-type`, `window-view`, `balcony`, `bathroom-unit`, `renovation`, `built-year`, `ceiling-height`, `heating-supply`, `room-furniture`, `parking-type`, `lot-type`, `video-review`, `online-show`, `disable-flat-plan-guess`, `is-image-order-change-allowed`, and private `location/apartment`.

`Код объекта: <value>.` is extracted deterministically into internal `sourceObjectCode`; the recognized prefix is removed from the public description while raw provenance is preserved. Cadastral values matching `^00:00:0+:0+$` are preliminary placeholders, not verified cadastral identities.

## Agents and media

Observed agent fields: full name, work phone, optional photo, and category `agency`. A dedicated agent external ID and agent email were not observed in the audited sample and remain optional.

Listing images use `picture`; agent photos use `sales-agent/photo`. Media identity ignores the query string. HTTP media is forbidden; HTTPS is required.

## Location and safety

- `EXACT` location precision is disabled.
- Default precision for every property type is `STREET`.
- Explicit `DISTRICT` override is allowed only for `HOUSE`, `HOUSE_PART`, `LAND`, `COTTAGE`, `TOWNHOUSE`, and `GARAGE_BOX`.
- Empty imports are forbidden; the maximum drop is 20% with manual approval above the threshold.
- Calibrated count bounds are 777–1458, maximum growth is 50%, and maximum invalid records are 1%.
- Automatic deactivation is enabled after two missing GOOD runs and 24 hours.
- Raw timestamps and offsets are preserved; normalized storage uses UTC.

## Calibration decisions

- OQ-04 is closed: the pilot uses employee phones from XML; the shared-office phone list is empty by owner decision. Same-phone/different-name evidence still goes to review.
- OQ-05 is closed: the calibrated AI-generation disclosure pattern had zero hits in three live reads. Findings remain `WARNING`; AI auto-edit is forbidden.
- The exact endpoint and employee PII are not stored in this document. Production remains unauthorized.

## Sanitized evidence

The synthetic fixture corpus is in `tests/fixtures/yrl/vladis-vt24/` and contains all 16 required cases, including malformed and truncated XML. Contract checks are in `tests/vladis-vt24-fixtures.test.ts` and `tests/vladis-vt24-profile.test.ts`.

Live test-mode evidence is summarized in
`docs/research/VLADIS_VT24_CALIBRATION_2026-10-05.md` and reproduced by the
opt-in `pnpm calibrate:vladis-feed` runner with `VLADIS_FEED_URL` supplied at
runtime.
