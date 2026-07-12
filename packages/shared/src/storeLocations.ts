export const VIRGINIA_STORE_LOCATIONS = [
  'Williamsburg',
  'Norfolk',
  'Richmond',
  'Colonial Heights',
  'Dinwiddie',
  'Blacksburg',
  'Alexandria',
  'Fredericksburg',
  'Chesapeake',
  'Virginia Beach',
  'Newport News',
  'Hampton',
  'Petersburg',
  'Midlothian',
  'Arlington',
  'Fairfax',
  'Roanoke',
] as const;

export type VirginiaStoreLocation = (typeof VIRGINIA_STORE_LOCATIONS)[number];

export function normalizeVirginiaStoreLocation(value: string | undefined | null): VirginiaStoreLocation {
  const clean = String(value || '').trim();
  const fallback = VIRGINIA_STORE_LOCATIONS[0];
  return (VIRGINIA_STORE_LOCATIONS.find((location) => location === clean) || fallback) as VirginiaStoreLocation;
}