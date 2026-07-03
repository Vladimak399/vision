# 20. План релизов

## Этапы R1

1. Foundation: schema/RLS/Auth, environments, CI.
2. Catalog: import и справочники.
3. Capture: sessions, Storage, bulk upload, jobs.
4. Intelligence: recognition, matching, aliases.
5. Operations: review, evidence, history, dashboard.
6. Delivery: Excel, retention, observability, production hardening.

## Go-live criteria

Golden dataset precision ≥97%; E2E и 500-photo test пройдены; 100% exported prices имеют evidence; security/RLS review завершен; backup/rollback и runbook проверены; admin/manager/reviewer прошли acceptance.

Rollout: internal pilot на одном магазине → 5 магазинов → все выбранные магазины. На каждом этапе сравниваются automation rate, corrections, processing time и AI cost. При precision ниже порога auto matching отключается feature flag, review и накопленные данные сохраняются.

## Rollback

Откат Vercel deployment, остановка новых jobs, сохранение очереди, повтор после исправления. Миграции только backward-compatible в рамках релиза. Владельцы: product — scope/KPI; engineering — reliability/security; operations — catalog/review acceptance.
