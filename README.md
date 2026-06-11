# Verdium

Verdium is organized as three separate apps:

- Verdium: customer mobile app
- Verdium Driver: driver mobile app
- Verdium Admin: desktop executable

The driver surface is isolated from the customer surface. Driver-only data such as vehicle details, insurance documents, tax records, and payout settings stay in the driver app and are only handed off through Verdium Admin.

## Structure

- `apps/customer` - customer-facing mobile app
- `apps/driver` - driver-only mobile app
- `apps/admin` - desktop admin executable
- `packages/shared` - shared UI, mock network, and verification utilities
- `packages/server-cache` - temporary local cache used until a real server exists

## Supabase Setup

Use environment files so credentials are not hardcoded.

1. Create local env files from examples:
- `.env.example` -> `.env`
- `apps/customer/.env.example` -> `apps/customer/.env`
- `apps/driver/.env.example` -> `apps/driver/.env`
- `apps/admin/.env.example` -> `apps/admin/.env`
- `packages/server-cache/.env.example` -> `packages/server-cache/.env`

2. Set your Supabase project values:
- `EXPO_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co`
- `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...`

3. Set API endpoint value:
- `EXPO_PUBLIC_VERDIUM_API_BASE_URL=https://api.your-domain.com`

4. Server-side secret (Node only, never mobile):
- `SUPABASE_SERVICE_ROLE_KEY=...`

5. Storage bucket for delivery photos:
- `SUPABASE_DELIVERY_BUCKET=phtool`

6. Run server cache locally:
- `npm run start:cache`

The customer and driver apps read `EXPO_PUBLIC_VERDIUM_API_BASE_URL` directly, so no code edits are needed when changing between local and hosted APIs.
