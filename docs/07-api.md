# 07. API

Mutation требуют Supabase session, role check, membership, CSRF и `Idempotency-Key`. Ошибка: `{ code, message, fieldErrors?, requestId }`.

Server Actions: `createCatalogImport`, `commitCatalogImport`, `createMonitoringSession`, `completeMonitoringSession`, `decideMatch`, `createReport`.

Routes: `POST /api/uploads/photos/sign`; `POST /api/sessions/:id/process`; `GET /api/sessions/:id/progress`; `GET /api/evidence/:id/url`; `GET /api/reports/:id/download`.

Zod валидирует вход. Pagination cursor-based. `409` — version conflict, `422` — validation, `429` — rate limit. Worker endpoints используют отдельную подпись.
