# PRD — AMS Data Hub

**Статус:** Active
**Product:** reusable MicroSaaS application starter

## Проблема и назначение

`AMS Data Hub` сокращает время запуска нового CRM, кабинета, аналитического
workspace или MicroSaaS. Он даёт нейтральные границы identity, организаций,
аудита, фоновой обработки, приватного UI и производного release-contract, но
не навязывает отраслевой домен.

## Пользователь и ценность

- solo owner получает проверяемую основу вместо повторной сборки платформы;
- оператор может провизионить пользователей и организации без public signup;
- будущий продукт получает multi-tenant и async foundation только как
  нейтральный reusable слой.

## Границы продукта

Starter включает: auth/session foundation, organizations and memberships,
Platform Admin, neutral `Project`, audit, notifications, outbox-plus-queue,
worker boundary, health routes and private/public UI shells.

Starter не включает: отраслевую модель, provider integrations, billing,
public signup, production identity, production secrets, database, domain or
deploy target.

## Производный продукт

Перед первым реальным пользователем derived repository обязан выбрать
`DELIVERY_PROFILE = COMMERCIAL | CRITICAL`, заменить identity/legal data,
создать собственные environment и release contracts, а также определить
доменные entities, integrations и нужный worker contract.
