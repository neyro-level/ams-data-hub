# CLIENT PROVISIONING

## Цель

Подключить новый client tenant, проект, 1–50 сайтов, пользователя и SEO-источники одной управляемой операцией без ручных записей в БД.

## Обязательные данные

- organization/project names и уникальные slugs;
- имя и уникальный lowercase login пользователя;
- назначенный Platform Admin пароль ровно из 8 печатных символов;
- tenant role: `VIEWER` по умолчанию;
- для каждого сайта: name/slug, exact HTTPS URL, timezone и Topvisor region;
- 20–100 уникальных ключевых запросов на сайт, вставленных построчно или загруженных из UTF-8 `.txt/.csv`;
- две бизнес-цели Метрики: `LEAD_SUBMIT` и `PHONE_CLICK`.

Credentials и provider IDs нельзя переносить между проектами по аналогии.

## Порядок

1. В `/admin/` запустить единый мастер создания клиента.
2. Создать одной транзакцией Organization → Project → Sites → User credential → Membership → SearchTargets → TrackedQuerySet → AuditEvent → OutboxEvent.
3. Передать назначенный пароль пользователю приватным каналом; не сохранять его в документах или сообщениях команды.
4. Проверить вход: пользователь сразу попадает в `/dashboard/` и видит только назначенную organization.
5. Worker автоматически находит точный Metrica counter и подтверждённый Webmaster host; администратор подтверждает предложенное соответствие двух целей.
6. Worker находит либо создаёт Topvisor project, добавляет Яндекс/Google × desktop/mobile и выбранный region, импортирует отсутствующие queries в группу «Основное ядро».
7. Перед первым платным checker worker получает цену и резервирует уникальный `ProviderOperation`; недоступная цена или неоднозначный ответ переводят подключение в `ACTION_REQUIRED` без повтора списания.
8. Первый rank-check запускается сразу; daily Yandex sync выполняется ежедневно, Topvisor positions — по понедельникам, competitors — сразу и в первый понедельник месяца.
9. Проверить уведомление о результате, первый report и четыре периода.
9. Release/deploy выполнять отдельной owner-командой.

Private operator config при необходимости синхронизируется только явным `config:sync --source <private-path>`: сначала dry-run, затем отдельный `--apply`. Deployment config sync не вызывает.

## Acceptance

- создание клиента атомарно; duplicate login/slug возвращает safe error;
- пароль отсутствует в logs, AuditEvent, URL и Git;
- public signup недоступен;
- client видит только свою organization;
- каждый сайт имеет четыре Topvisor targets и ядро в границах 20–100;
- повторная доставка onboarding event не повторяет paid checker;
- Platform Admin/SEO Analyst видят safe notifications, CLIENT_VIEWER не получает `/notifications/`;
- enabled sources имеют подтверждённый mapping и свежий успешный SourceRun;
- four valid ReportSnapshots на site;
- `partial`, `stale` и missing values отображаются честно;
- secrets/raw provider data отсутствуют в Git/browser/logs;
- backup/recovery contract не ослаблен.

Live access и integration state подтверждаются runtime evidence, а не этим runbook.
