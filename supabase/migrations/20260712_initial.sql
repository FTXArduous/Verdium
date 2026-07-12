create table if not exists public.deliveries (
  id text primary key,
  order_id text not null,
  address text not null,
  elapsed_seconds integer not null default 0,
  image_uri text not null,
  created_at timestamptz not null default now(),
  delivered_at timestamptz not null default now(),
  status text not null default 'delivered'
);

create index if not exists deliveries_created_at_idx on public.deliveries (created_at desc);
create index if not exists deliveries_order_id_idx on public.deliveries (order_id);

create table if not exists public.customer_requests (
  id text primary key,
  customer_id text not null,
  address text not null,
  hash_serial text not null,
  qr_token text not null,
  created_at timestamptz not null default now(),
  status text not null default 'pending',
  dispatched_to text,
  confirmed_driver_id text,
  hash_locked boolean not null default false,
  offer_attempted_driver_ids jsonb not null default '[]'::jsonb,
  offer_expires_at timestamptz
);

create index if not exists customer_requests_created_at_idx on public.customer_requests (created_at desc);
create index if not exists customer_requests_status_idx on public.customer_requests (status);
create index if not exists customer_requests_dispatched_to_idx on public.customer_requests (dispatched_to);

create table if not exists public.driver_notifications (
  id text primary key,
  driver_id text not null,
  request_id text not null,
  message text not null,
  address text not null,
  created_at timestamptz not null default now(),
  closed boolean not null default false
);

create index if not exists driver_notifications_created_at_idx on public.driver_notifications (created_at desc);
create index if not exists driver_notifications_driver_id_idx on public.driver_notifications (driver_id);
create index if not exists driver_notifications_closed_idx on public.driver_notifications (closed);

create table if not exists public.driver_pings (
  id text primary key,
  driver_id text not null,
  label text not null,
  created_at timestamptz not null default now(),
  fee numeric(10,2) not null default 0.01
);

create index if not exists driver_pings_created_at_idx on public.driver_pings (created_at desc);
create index if not exists driver_pings_driver_id_idx on public.driver_pings (driver_id);

create table if not exists public.driver_queue (
  id text primary key,
  request_id text not null,
  driver_id text not null,
  address text not null,
  hash_serial text not null,
  qr_token text not null,
  created_at timestamptz not null default now(),
  status text not null default 'queued'
);

create index if not exists driver_queue_created_at_idx on public.driver_queue (created_at desc);
create index if not exists driver_queue_driver_id_idx on public.driver_queue (driver_id);
create index if not exists driver_queue_status_idx on public.driver_queue (status);
create index if not exists driver_queue_request_id_idx on public.driver_queue (request_id);

create table if not exists public.cancel_log (
  id text primary key,
  request_id text not null,
  queue_item_id text,
  cancelled_by text not null,
  created_at timestamptz not null default now()
);

create index if not exists cancel_log_created_at_idx on public.cancel_log (created_at desc);
create index if not exists cancel_log_request_id_idx on public.cancel_log (request_id);
create index if not exists cancel_log_cancelled_by_idx on public.cancel_log (cancelled_by);

create table if not exists public.driver_photo_archive (
  id text primary key,
  driver_id text not null,
  session_id text not null,
  photo_phase text not null,
  label text not null,
  image_uri text not null,
  created_at timestamptz not null default now(),
  archived_at timestamptz not null default now()
);

create index if not exists driver_photo_archive_created_at_idx on public.driver_photo_archive (created_at desc);
create index if not exists driver_photo_archive_driver_id_idx on public.driver_photo_archive (driver_id);
create index if not exists driver_photo_archive_session_id_idx on public.driver_photo_archive (session_id);
