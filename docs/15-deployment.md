# 15. Развертывание

Окружения: local, preview, production с отдельными Supabase projects/buckets и ключами. Vercel размещает Next.js; production branch — `main`. Secrets: Supabase URL/anon/service role, OpenAI key, worker signature; только публичные значения имеют `NEXT_PUBLIC_`.

Порядок: migration check → typecheck/tests/build → DB migration → app deploy → smoke test → worker enable. Additive migrations применяются до кода; destructive — отдельным релизом после backup/backfill.

Наблюдаемость: structured logs без PII/изображений, request/correlation ID, error tracking, job latency/failure, AI cost, storage growth. Alerts: job failure rate, queue age, OpenAI errors, retention failures. Rollback приложения не откатывает БД автоматически.
