# 17. Тестирование

## Уровни

- Unit: money/unit normalization, scoring, thresholds, roles, retention dates.
- Contract: Zod API, OpenAI structured fixtures, Excel schema.
- Integration: Supabase RLS, Storage signed URLs, jobs/idempotency, history.
- E2E: import → 100 photos → processing → review → complete → Excel.
- Regression eval: размеченный dataset по категориям, брендам, размерам и качеству фото.

Обязательные сценарии: duplicate upload; malformed import; AI timeout; unreadable/multiple price tags; alias correction; two reviewers conflict; expired evidence; report retry; cross-company denial.

Release gates: typecheck/lint/tests/build green; recognition precision ≥97% на golden set; auto match не ниже текущего baseline; 500-photo load test без потери jobs; экспорт открывается в Excel и не содержит formula injection.
