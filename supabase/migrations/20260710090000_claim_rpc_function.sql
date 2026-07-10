-- RPC функция для атомарного claim run'а — TASK-34
-- Заменяет UPDATE-fallback в claim-run.ts для лучшей производительности

-- Создаем RPC функцию claim_online_source_run
create or replace function public.claim_online_source_run(run_id uuid)
returns boolean as $$
declare
  updated_count integer;
begin
  -- Атомарно переводим queued -> running и считаем обновленные строки
  update public.online_source_runs
  set
    status = 'running',
    started_at = now(),
    updated_at = now()
  where
    id = claim_online_source_run.run_id
    and status = 'queued'
    and status = 'queued'; -- повтор для условия where

  get diagnostics updated_count = row_count;

  -- Возвращаем true, если строка была обновлена (1), false (0)
  return updated_count = 1;
end;
$$ language plpgsql security definer;

-- Комментарий для документации
comment on function public.claim_online_source_run(run_id uuid) is
'Атомарный claim run''а: переводит queued → running, возвращает true если успешно';