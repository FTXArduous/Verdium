create table if not exists public.profiles (
  id text primary key,
  email text not null unique,
  password text not null,
  display_name text not null,
  role text not null default 'customer',
  store_location text not null default 'Williamsburg',
  license_image_uri text not null,
  insurance_image_uri text,
  delivery_image_uri text,
  vehicle_image_uri text,
  delivery_data text,
  documents jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles
  add column if not exists store_location text not null default 'Williamsburg';

create index if not exists profiles_created_at_idx on public.profiles (created_at desc);
create index if not exists profiles_email_idx on public.profiles (email);
create index if not exists profiles_role_idx on public.profiles (role);
create index if not exists profiles_store_location_idx on public.profiles (store_location);

insert into storage.buckets (id, name, public)
values ('profile-images', 'profile-images', true)
on conflict (id) do update
set public = true;
