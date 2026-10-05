# Joywork marketplace feed audit — 2026-10-05

Scope: test-mode structural audit, no production import.

| Profile | Bytes | Records | Distinct external IDs | Result |
| --- | ---: | ---: | ---: | --- |
| Yandex Realty | 131293 | 36 | 36 | non-empty YRL structure verified |
| Avito v3 | 49 | 0 | 0 | valid empty root signature verified |
| CIAN v2 | 47 | 0 | 0 | valid empty root/version signature verified |
| Domclick | 194 | 0 | 0 | valid empty YRL root/namespace verified |

Raw files were used only under ignored `.local/`. URLs, listing payloads,
employee contacts and other PII are intentionally absent from this evidence.

The empty Avito, CIAN and Domclick samples prove transport and root signatures,
not full listing-field compatibility. Their profile calibration remains
bootstrap until non-empty samples are available. No schedule, apply,
deactivation or production action was authorized.
