create unique index if not exists jobs_company_correlation_id_key
  on public.jobs(company_id, correlation_id);
