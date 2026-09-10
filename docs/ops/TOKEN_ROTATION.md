# TOKEN ROTATION

## Scope

- provider OAuth/API tokens;
- Better Auth secret;
- PostgreSQL app/migrator passwords;
- offsite backup credentials;
- external delivery credentials, если затронут Leads API.

Basic Auth не является частью текущей application architecture.

## Общие правила

- source of truth: Doppler/project protected env;
- не печатать значения в chat, shell history, logs или docs;
- не передавать secrets через argv;
- один credential не переиспользовать между web, worker, migrator и backup;
- rotation выполнять по одному boundary с rollback credential до proof;
- production restart/deploy требует отдельной owner-команды.

## Provider token

1. Выпустить credential только с read-only scope.
2. Обновить worker secret source и protected env.
3. Выполнить provider preflight.
4. Запустить bounded worker smoke.
5. Проверить safe SourceRun status/logs.
6. Отозвать старый token после успешного proof.

Web env не должен получить provider token.

## Better Auth secret

1. Зафиксировать ожидаемое влияние на active sessions.
2. Обновить только web secret source/env.
3. Перезапустить web runtime approved способом.
4. Проверить login, disabled user и analyst/client isolation.
5. Убедиться, что secret не попал в build/browser/logs.

Rotation может инвалидировать sessions; это ожидаемое решение, не скрытая побочная операция.

## PostgreSQL credentials

1. Определить app или migrator role; не смешивать.
2. Создать/обновить credential server-side без вывода значения.
3. Обновить соответствующий protected env.
4. Проверить app readiness или migration connectivity.
5. Проверить worker отдельно, если менялся app runtime credential.
6. Отозвать старый credential после proof.

Никаких `db push`, restore или destructive data operation в рамках rotation.

## Backup credentials

1. Новый restricted credential имеет доступ только к dedicated private bucket.
2. Обновить backup env.
3. Выполнить backup upload и HEAD confirmation.
4. Выполнить isolated restore smoke.
5. Только затем отозвать старый credential.

## Incident evidence

Фиксировать время, boundary, safe credential identifier, выполненные smoke checks и итог. Secret value, authorization header, DB URL и response body не записывать.
