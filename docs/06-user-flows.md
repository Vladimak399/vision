# 06. User Flows

## Catalog
Файл → mapping колонок → preview → validation → commit. Ошибки доступны для скачивания; повторный SKU обновляется только в режиме `upsert`.

## Monitoring
Competitor/store/date → draft → upload → processing → review. Закрытие вкладки не прерывает jobs.

## Review
Reviewer видит `needs_review`/`unmatched`, evidence и candidates. Действия: accept, choose, search, reject. Correction создает alias. Optimistic locking предотвращает двойное решение.

## Export
Complete → immutable snapshot → Excel job → signed download. Failed photo можно повторить; недоступность OpenAI не удаляет оригинал.
