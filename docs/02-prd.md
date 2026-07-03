# 02. Product Requirements

## Роли

- `admin`: пользователи, магазины, конкуренты, настройки и удаление.
- `manager`: ассортимент, сессии, review, история и экспорт.
- `reviewer`: evidence и решения по спорным match.

## Основной сценарий

Импорт Excel/CSV → создание сессии → загрузка до 500 JPG/PNG/WebP → recognition → matching → review спорных позиций → завершение → Excel.

## Требования

- Импорт валидирует SKU, название, бренд, размер и собственную цену; ошибки содержат номер строки.
- Загрузка и фоновые операции идемпотентны.
- Recognized item содержит название, бренд, размер, цену, валюту, confidence и bbox.
- Alias применяется до fuzzy search; подтвержденная коррекция создает или усиливает alias.
- Сессию нельзя завершить с нерешенными позициями.
- Отчет строится из immutable snapshot завершенной сессии.

## Статусы

- Session: `draft | uploading | processing | review | completed | failed | cancelled`.
- Photo: `uploaded | queued | processing | processed | failed | expired`.
- Item: `recognized | matched | needs_review | unmatched | confirmed | rejected`.
- Decision: `auto | accepted | corrected | rejected`.

Деньги хранятся в minor units, валюта — ISO 4217. Изменения цен, aliases и отчеты фиксируются в audit log.
