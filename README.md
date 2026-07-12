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
- `packages/server-cache` - HTTP cache adapter backed by Supabase or local fallback

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
- `EXPO_PUBLIC_VERDIUM_API_BASE_URL=http://localhost:4010` (local) or `https://your-cache-api.your-domain.com`
- Do not point this to `https://<project>.supabase.co/rest/v1`; apps expect the Verdium cache adapter endpoints like `/api/profiles`.

4. Set Google Maps key for the driver delivery satellite view:
- `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY=AIzaSy...`

5. Set Google Maps key for the admin desktop delivery map:
- `VERDIUM_GOOGLE_MAPS_API_KEY=AIzaSy...`

6. Server-side secret (Node only, never mobile):
- `SUPABASE_SERVICE_ROLE_KEY=...`

7. Storage bucket for delivery photos:
- `SUPABASE_DELIVERY_BUCKET=phtool`

8. Storage bucket for profile photos:
- `SUPABASE_PROFILE_BUCKET=profile-images`

9. Required Supabase tables for the shared address and delivery flow:
- `deliveries`
- `customer_requests`
- `driver_notifications`
- `driver_pings`
- `driver_queue`
- `cancel_log`
- `profiles`
- Apply the schema from `supabase/migrations/20260712_initial.sql`
- Apply `supabase/migrations/20260712_profiles_and_storage.sql` for profile storage + `profile-images` bucket

10. Run server cache locally:
- `npm run start:cache`

The customer and driver apps read `EXPO_PUBLIC_VERDIUM_API_BASE_URL` directly, so no code edits are needed when changing between local and hosted APIs.

## Downloading Deploy Binaries

Do not use `View raw` for files under `release/deploy`.
Those files are tracked by Git LFS and raw repository views can return pointer text instead of usable binaries.

Use GitHub Releases assets instead:

1. Open the repository `Releases` page.
2. Open `Verdium Latest Deploy Assets` (tag `git-large-latest`).
3. Download:
- `Verdium-Admin-win-unpacked.zip`
- `Verdium-Driver.apk`
- `Verdium-Customer.apk`

4. For admin desktop:
- Extract `Verdium-Admin-win-unpacked.zip` fully.
- Run `Verdium-Admin.exe` from the extracted folder.
- Do not run a copied standalone EXE by itself; Electron runtime files (including `ffmpeg.dll`) must stay beside it.

The release is automatically refreshed from `git-large` by `.github/workflows/publish-deploy-assets.yml`.
