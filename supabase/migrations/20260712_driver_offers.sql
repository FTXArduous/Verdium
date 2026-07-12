alter table public.customer_requests
  add column if not exists offer_attempted_driver_ids jsonb not null default '[]'::jsonb,
  add column if not exists offer_expires_at timestamptz;

create index if not exists customer_requests_offer_expires_at_idx
  on public.customer_requests (offer_expires_at)
  where status = 'offered';
