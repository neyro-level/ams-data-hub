# MASTER PLAN

Только незавершённая работа; завершённые этапы остаются в Git/SourceCraft.

## NOW — Starter baseline

- сохранить AMS IMPULSE как рабочий reference vertical и не подключать starter к его production data, secrets, доменам или инфраструктуре;
- подтвердить clean initial `main`, private SourceCraft repository и zero-CI на push/Pull Request;
- перед началом производного продукта создать отдельный рабочий stream и обновить `docs/PRODUCT.md`, `docs/ARCHITECTURE.md` и этот план под его реальный scope.

## NEXT — Derived product gate

- выбрать продуктовый профиль `TENANCY / ASYNC / DATA / DELIVERY / PLATFORM_ADMIN` без наследования сложности «на будущее»;
- выбрать `DELIVERY_PROFILE`; real-user auth, PII, платежи, ценная БД или критичные интеграции требуют `CRITICAL`;
- заменить branding, public routes, legal content, provider integrations и production identifiers только по фактическому scope;
- удалить ненужные SEO-модули лишь после проверки их зависимостей и сохранения platform foundation.

## LATER

- выделять reusable improvements обратно в starter только управляемым snapshot-процессом; автоматической синхронизации с производными продуктами нет.
