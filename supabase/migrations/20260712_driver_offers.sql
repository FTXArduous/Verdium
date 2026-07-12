alter table public.customer_requests
  add column if not exists offer_attempted_driver_ids jsonb not null default '[]'::jsonb,
  add column if not exists offer_expires_at timestamptz,
  add column if not exists delivery_stops jsonb not null default '[]'::jsonb;

alter table public.driver_queue
  add column if not exists delivery_stops jsonb not null default '[]'::jsonb;

create index if not exists customer_requests_offer_expires_at_idx
  on public.customer_requests (offer_expires_at)
  where status = 'offered';
