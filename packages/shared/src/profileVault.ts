export type ProfileRole = 'customer' | 'driver' | 'admin';
export type ProfileDocumentKind = 'license' | 'insurance' | 'delivery-data' | 'vehicle-id' | 'payment';

export type ProfileDocument = {
  kind: ProfileDocumentKind;
  label: string;
  summary: string;
  imageUri?: string;
};

export type ProfileRecord = {
  email: string;
  password: string;
  displayName: string;
  role: ProfileRole;
  storeLocation: string;
  createdAt: string;
  documents: ProfileDocument[];
};

const profileVault: ProfileRecord[] = [
  {
    email: 'customer@verdium.example',
    password: 'CustomerVerdium!2026',
    displayName: 'Verdium Customer',
    role: 'customer',
    storeLocation: 'Richmond',
    createdAt: new Date('2026-07-01T12:00:00.000Z').toISOString(),
    documents: [
      {
        kind: 'license',
        label: 'Customer License',
        summary: 'Identity scan required before delivery request submission.',
      },
      {
        kind: 'delivery-data',
        label: 'Delivery Data',
        summary: 'Address history, request status, and delivery photo feed.',
      },
      {
        kind: 'insurance',
        label: 'Insurance',
        summary: 'Customer insurance record stored for shared verification.',
      },
    ],
  },
  {
    email: 'driver@verdium.example',
    password: 'DriverVerdium!2026',
    displayName: 'Verdium Driver',
    role: 'driver',
    storeLocation: 'Norfolk',
    createdAt: new Date('2026-07-01T12:00:00.000Z').toISOString(),
    documents: [
      {
        kind: 'license',
        label: 'Driver License',
        summary: 'Driver identity scan is required before dispatch access is granted.',
      },
      {
        kind: 'insurance',
        label: 'Driver Insurance',
        summary: 'Insurance card and policy reference shown as a separate card.',
      },
      {
        kind: 'vehicle-id',
        label: 'Vehicle ID',
        summary: 'Vehicle identification, plate, and registration assets are gated in admin.',
      },
      {
        kind: 'delivery-data',
        label: 'Delivery Data',
        summary: 'Queue items, trip photos, and delivery proof archive.',
      },
    ],
  },
  {
    email: 'admin@verdium.example',
    password: 'VerdiumAdmin!2026',
    displayName: 'Verdium Admin',
    role: 'admin',
    storeLocation: 'Williamsburg',
    createdAt: new Date('2026-07-01T12:00:00.000Z').toISOString(),
    documents: [
      {
        kind: 'payment',
        label: 'Payment Review',
        summary: 'Owner payout review and billing controls for every account.',
      },
      {
        kind: 'delivery-data',
        label: 'Delivery Data',
        summary: 'Dispatch logs, proofs, and delivery records across all apps.',
      },
    ],
  },
];

export function getProfiles() {
  return [...profileVault];
}

export function findProfileByEmail(email: string) {
  const clean = String(email || '').trim().toLowerCase();
  return profileVault.find((profile) => profile.email.toLowerCase() === clean) || null;
}

export function authenticateProfile(email: string, password: string) {
  const profile = findProfileByEmail(email);
  if (!profile) {
    return null;
  }

  if (profile.password !== String(password || '')) {
    return null;
  }

  return profile;
}

export function upsertProfile(profile: ProfileRecord) {
  const index = profileVault.findIndex((item) => item.email.toLowerCase() === profile.email.toLowerCase());
  if (index >= 0) {
    profileVault[index] = profile;
  } else {
    profileVault.unshift(profile);
  }
  return profile;
}
