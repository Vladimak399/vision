alter table public.jobs
  add column if not exists model text,
  add column if not exists input_tokens integer,
  add column if not exists output_tokens integer,
  add column if not exists estimated_cost_microusd bigint,
  add column if not exists duration_ms integer;
