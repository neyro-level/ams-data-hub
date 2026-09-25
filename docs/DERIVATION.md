# Copy-source derivation

`АМС Старт` переносится копированием исходного repository. Генератора в первой
версии нет: это сохраняет Git-историю, позволяет review каждой product-specific
замены и не создаёт второй distribution service.

## Новый производный repository

1. Создайте новый repository из чистого commit starter; не наследуйте его
   production branch, deployment host, database или secrets.
2. Переименуйте файлы и пути, содержащие starter slug, включая Compose,
   systemd, Nginx, backup и asset names.
3. В `starter.identity.json` установите `mode: "derived"` и замените каждое
   поле `identity` значениями нового продукта. Заполните блок `derivation`:
   собственный repository, default branch, `DELIVERY_PROFILE`, владельца
   migration baseline и решение `enabled`/`disabled` по каждому optional module.
4. Замените starter identity во всех application, documentation, operation и
   legal files. Legal `TODO:` закрываются до публикации, не при копировании
   в личную черновую ветку.
5. Создайте собственные secrets только через approved Secret Master project;
   не переносите `.env.local`, database URLs, tokens или credentials.
6. Настройте product-specific PostgreSQL roles/topology и manual exact-head
   delivery gate согласно выбранному `DELIVERY_PROFILE`.
7. Запустите `pnpm derive:verify`. Он не пропустит starter slug, example
   origin или legal placeholder в tracked text file либо имени файла.
8. До первого product-кода выполните `pnpm derive:smoke`: verification-only
   сценарий создаст одноразовую копию, новую локальную Git identity, установит
   зависимости из локального pnpm store и запустит Prisma, quick, unit и build.
   Это не генератор продукта: результат всегда удаляется и не публикуется.
9. Затем выполните обязательные проверки производного продукта и создайте
   отдельный PR. Сам starter не выпускается в production.

## Обязательные решения копии

- `outboxPlusQueue`: оставить сильной асинхронной основой или явно отключить;
- `pwa`: оставить install/offline shell либо удалить вместе с cache namespace;
- `platformAdmin`: оставить только при явной operational ownership модели;
- migration baseline: новая копия владеет перенесёнными migrations и заменяет
  starter database roles/application names до первого применения;
- delivery: новый продукт выбирает собственный профиль и не наследует
  экспериментальный статус starter автоматически.

## Что проверяет verifier

Verifier читает только tracked text files и credential-free identity manifest.
Он не открывает secret manager, `.env.local`, database или remote deployment.
Это делает clean-room smoke повторяемым: успешный прогон доказывает, что
копия не сохранила скрытую identity starter.
