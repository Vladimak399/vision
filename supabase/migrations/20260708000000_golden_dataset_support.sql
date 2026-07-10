-- Add golden dataset support fields to recognized_items
-- This enables collecting labeled data for training and evaluation

-- Add verification status enum before tables reference it.
do $$
begin
  create type public.verification_status as enum ('pending', 'verified', 'rejected');
exception
  when duplicate_object then null;
end $$;

alter table public.recognized_items
add column if not exists is_golden boolean default false,
add column if not exists golden_confidence_score numeric(5,4),
add column if not exists golden_verified_by uuid references public.profiles(id),
add column if not exists golden_verified_at timestamptz,
add column if not exists golden_notes text,
add column if not exists is_ground_truth boolean default false;

-- Add index for golden items
create index if not exists idx_recognized_items_golden on public.recognized_items(company_id, is_golden, is_ground_truth)
where is_golden = true or is_ground_truth = true;

-- Create table for golden dataset samples
create table if not exists public.golden_dataset_samples (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  session_id uuid not null references public.monitoring_sessions(id) on delete cascade,
  photo_id uuid not null references public.monitoring_photos(id) on delete cascade,
  recognized_item_id uuid not null references public.recognized_items(id) on delete cascade,
  ground_truth_name text not null,
  ground_truth_brand text,
  ground_truth_size_text text,
  ground_truth_price_minor bigint,
  ground_truth_currency char(3) default 'RUB',
  ai_predicted_name text,
  ai_predicted_brand text,
  ai_predicted_size_text text,
  ai_predicted_price_minor bigint,
  ai_predicted_currency char(3) default 'RUB',
  match_score numeric(5,4),
  is_correct_match boolean,
  verification_status public.verification_status default 'pending',
  verified_by uuid references public.profiles(id),
  verified_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Create unique index for golden samples to prevent duplicates
create unique index if not exists golden_samples_unique on public.golden_dataset_samples(
  company_id,
  recognized_item_id
) where verification_status = 'verified';

-- Add function to calculate golden dataset accuracy
create or replace function public.calculate_golden_dataset_accuracy(company_id uuid)
returns table(
  total_samples int,
  correct_matches int,
  accuracy numeric(5,4),
  avg_confidence numeric(5,4)
) as $$
begin
  return query
  select
    count(*)::int as total_samples,
    sum(case when is_correct_match then 1 else 0 end)::int as correct_matches,
    (sum(case when is_correct_match then 1 else 0 end)::numeric / count(*))::numeric(5,4) as accuracy,
    avg(match_score)::numeric(5,4) as avg_confidence
  from public.golden_dataset_samples
  where company_id = $1
    and verification_status = 'verified';
end;
$$ language plpgsql stable;

-- Add function to get golden dataset samples for review
create or replace function public.get_pending_golden_samples(company_id uuid, limit_count int default 10)
returns table(
  id uuid,
  session_id uuid,
  photo_id uuid,
  recognized_item_id uuid,
  ai_predicted_name text,
  ground_truth_name text,
  match_score numeric(5,4)
) as $$
begin
  return query
  select
    gds.id,
    gds.session_id,
    gds.photo_id,
    gds.recognized_item_id,
    gds.ai_predicted_name,
    gds.ground_truth_name,
    gds.match_score
  from public.golden_dataset_samples gds
  join public.recognized_items ri on gds.recognized_item_id = ri.id
  where ri.company_id = $1
    and gds.verification_status = 'pending'
  order by gds.created_at
  limit limit_count;
end;
$$ language plpgsql stable;
