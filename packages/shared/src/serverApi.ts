export type DeliverySubmission = {
  orderId: string;
  address: string;
  elapsedSeconds: number;
  imageUri: string;
};

export type AdminDeliveryRecord = {
  id: string;
  orderId: string;
  address: string;
  elapsedSeconds: number;
  imageUri: string;
  createdAt: string;
  deliveredAt: string;
  status: 'delivered';
};

export type CustomerDeliveryRecord = {
  orderId: string;
  address: string;
  imageUri: string;
  deliveredAt: string;
};

export type ProfileDocument = {
  kind: 'license' | 'insurance' | 'delivery-data' | 'vehicle-id' | 'payment';
  label: string;
  summary: string;
  imageUri?: string;
};

export type ProfileRecord = {
  id?: string;
  email: string;
  password: string;
  displayName: string;
  role: 'customer' | 'driver' | 'admin';
  storeLocation?: string;
  licenseImageUri?: string;
  insuranceImageUri?: string;
  deliveryImageUri?: string;
  vehicleImageUri?: string;
  deliveryData?: string;
  documents: ProfileDocument[];
  createdAt?: string;
  updatedAt?: string;
};

let serverSimulationEnabled = false;
let terminalHostUrl = '';

export function setServerSimulationEnabled(enabled: boolean) {
  serverSimulationEnabled = enabled;
}

export function isServerSimulationEnabled() {
  return serverSimulationEnabled;
}

export function setTerminalHostUrl(hostUrl: string) {
  const cleanHost = String(hostUrl || '').trim().replace(/\/$/, '');
  terminalHostUrl = cleanHost && !/^https?:\/\//i.test(cleanHost) ? `http://${cleanHost}` : cleanHost;
}

export function getTerminalHostUrl() {
  return terminalHostUrl;
}

function resolveBaseUrl(baseUrl?: string) {
  if (serverSimulationEnabled) {
    throw new Error('Wi-Fi simulation mode is enabled. Server functions are unavailable.');
  }

  const maybeGlobal = globalThis as {
    process?: { env?: Record<string, string | undefined> };
    __VERDIUM_API_BASE_URL__?: string;
  };

  const envUrl = maybeGlobal.process?.env?.EXPO_PUBLIC_VERDIUM_API_BASE_URL || maybeGlobal.__VERDIUM_API_BASE_URL__;
  const resolved = String(baseUrl || terminalHostUrl || envUrl || '').trim().replace(/\/$/, '');

  if (!resolved) {
    // Keep release builds from crashing on startup if env injection is missing.
    return 'http://localhost:4010';
  }

  return resolved;
}

export type CustomerRequestSubmission = {
  customerId: string;
  address: string;
  hashSerial: string;
  qrToken: string;
};

export type CustomerRequestRecord = {
  id: string;
  customerId: string;
  address: string;
  hashSerial: string;
  qrToken: string;
  createdAt: string;
  status: 'pending' | 'confirmed' | 'pushed' | 'dispatched' | 'cancelled' | 'denied';
  dispatchedTo?: string;
  confirmedDriverId?: string;
  hashLocked?: boolean;
};

export type DriverNotification = {
  id: string;
  driverId: string;
  requestId: string;
  message: string;
  address: string;
  createdAt: string;
  closed: boolean;
};

export type DriverPhotoArchiveEntry = {
  phase: 'before-trip' | 'during-trip';
  label: string;
  imageUri: string;
  createdAt: string;
};

export type DriverPhotoArchiveSubmission = {
  driverId: string;
  sessionId: string;
  photos: DriverPhotoArchiveEntry[];
};

export type ProfileImageUploadRequest = {
  imageBase64: string;
  mimeType: string;
  fileName?: string;
  folder?: string;
};

export type ProfileImageUploadResponse = {
  imageUri: string;
};

export type TerminalDevice = {
  id: string;
  name: string;
  role: 'customer' | 'driver';
  ipAddress: string;
  connectedAt: string;
};

export async function connectToTerminalHost(payload: {
  hostUrl: string;
  deviceId: string;
  deviceName: string;
  role: 'customer' | 'driver';
}): Promise<{ terminalName: string; devices: TerminalDevice[] }> {
  setTerminalHostUrl(payload.hostUrl);
  setServerSimulationEnabled(false);
  const response = await fetch(`${resolveBaseUrl()}/api/terminal/devices`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`terminal connection failed with status ${response.status}`);
  }
  return response.json();
}

export async function submitDeliveryCompletionToServer(
  submission: DeliverySubmission,
  baseUrl?: string
): Promise<AdminDeliveryRecord> {
  const response = await fetch(`${resolveBaseUrl(baseUrl)}/api/deliveries`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(submission),
  });

  if (!response.ok) {
    throw new Error(`submit failed with status ${response.status}`);
  }

  const payload = await response.json();
  return payload.delivery as AdminDeliveryRecord;
}

export async function fetchAdminDeliveriesFromServer(baseUrl?: string): Promise<AdminDeliveryRecord[]> {
  const response = await fetch(`${resolveBaseUrl(baseUrl)}/api/deliveries/admin`);
  if (!response.ok) {
    throw new Error(`admin fetch failed with status ${response.status}`);
  }
  const payload = await response.json();
  return payload.deliveries as AdminDeliveryRecord[];
}

export async function fetchCustomerDeliveriesFromServer(baseUrl?: string): Promise<CustomerDeliveryRecord[]> {
  const response = await fetch(`${resolveBaseUrl(baseUrl)}/api/deliveries/customer`);
  if (!response.ok) {
    throw new Error(`customer fetch failed with status ${response.status}`);
  }
  const payload = await response.json();
  return payload.deliveries as CustomerDeliveryRecord[];
}

export async function fetchProfilesFromServer(baseUrl?: string, email?: string): Promise<ProfileRecord[]> {
  const query = email ? `?email=${encodeURIComponent(email)}` : '';
  const response = await fetch(`${resolveBaseUrl(baseUrl)}/api/profiles${query}`);
  if (!response.ok) {
    throw new Error(`profile fetch failed with status ${response.status}`);
  }
  const payload = await response.json();
  return payload.profiles as ProfileRecord[];
}

export async function saveProfileToServer(profile: ProfileRecord, baseUrl?: string): Promise<ProfileRecord> {
  const response = await fetch(`${resolveBaseUrl(baseUrl)}/api/profiles`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(profile),
  });
  if (!response.ok) {
    throw new Error(`profile save failed with status ${response.status}`);
  }
  const payload = await response.json();
  return payload.profile as ProfileRecord;
}

export async function uploadProfileImageToServer(
  upload: ProfileImageUploadRequest,
  baseUrl?: string
): Promise<ProfileImageUploadResponse> {
  const response = await fetch(`${resolveBaseUrl(baseUrl)}/api/uploads/profile-image`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(upload),
  });
  if (!response.ok) {
    throw new Error(`profile image upload failed with status ${response.status}`);
  }
  const payload = await response.json();
  return payload as ProfileImageUploadResponse;
}

export async function submitCustomerRequestToServer(
  request: CustomerRequestSubmission,
  baseUrl?: string
): Promise<CustomerRequestRecord> {
  const response = await fetch(`${resolveBaseUrl(baseUrl)}/api/requests/customer`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    throw new Error(`customer request failed with status ${response.status}`);
  }
  const payload = await response.json();
  return payload.request as CustomerRequestRecord;
}

export async function fetchCustomerRequestsFromServer(customerId: string, baseUrl?: string): Promise<CustomerRequestRecord[]> {
  const response = await fetch(
    `${resolveBaseUrl(baseUrl)}/api/requests/customer?customerId=${encodeURIComponent(customerId)}`
  );
  if (!response.ok) {
    throw new Error(`customer request fetch failed with status ${response.status}`);
  }
  const payload = await response.json();
  return payload.requests as CustomerRequestRecord[];
}

export async function cancelCustomerRequestToServer(
  requestId: string,
  customerId: string,
  baseUrl?: string
): Promise<void> {
  const response = await fetch(`${resolveBaseUrl(baseUrl)}/api/requests/customer/cancel`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ requestId, customerId }),
  });
  if (!response.ok) {
    throw new Error(`customer cancel failed with status ${response.status}`);
  }
}

export async function fetchAdminRequestsFromServer(baseUrl?: string): Promise<CustomerRequestRecord[]> {
  const response = await fetch(`${resolveBaseUrl(baseUrl)}/api/requests/admin`);
  if (!response.ok) {
    throw new Error(`admin request fetch failed with status ${response.status}`);
  }
  const payload = await response.json();
  return payload.requests as CustomerRequestRecord[];
}

export async function dispatchRequestToDriver(
  payload: { requestId: string; driverId: string; message: string },
  baseUrl?: string
): Promise<DriverNotification> {
  const response = await fetch(`${resolveBaseUrl(baseUrl)}/api/requests/admin/dispatch`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`dispatch failed with status ${response.status}`);
  }
  const data = await response.json();
  return data.notification as DriverNotification;
}

export async function fetchDriverNotifications(driverId: string, baseUrl?: string): Promise<DriverNotification[]> {
  const response = await fetch(
    `${resolveBaseUrl(baseUrl)}/api/driver/notifications?driverId=${encodeURIComponent(driverId)}`
  );
  if (!response.ok) {
    throw new Error(`notification fetch failed with status ${response.status}`);
  }
  const data = await response.json();
  return data.notifications as DriverNotification[];
}

export type DriverPing = {
  id: string;
  driverId: string;
  label: string;
  createdAt: string;
  fee: number;
};

export async function sendDriverPing(driverId: string, label: string, baseUrl?: string): Promise<void> {
  const response = await fetch(`${resolveBaseUrl(baseUrl)}/api/driver/ping`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ driverId, label }),
  });
  if (!response.ok) {
    throw new Error(`ping failed with status ${response.status}`);
  }
}

export async function fetchDriverPings(baseUrl?: string): Promise<DriverPing[]> {
  const response = await fetch(`${resolveBaseUrl(baseUrl)}/api/driver/pings`);
  if (!response.ok) {
    throw new Error(`pings fetch failed with status ${response.status}`);
  }
  const data = await response.json();
  return data.pings as DriverPing[];
}

export type DriverQueueItem = {
  id: string;
  requestId: string;
  driverId: string;
  address: string;
  hashSerial: string;
  qrToken: string;
  createdAt: string;
  status: 'queued' | 'cancelled';
};

export async function fetchDriverQueue(driverId: string, baseUrl?: string): Promise<DriverQueueItem[]> {
  const response = await fetch(
    `${resolveBaseUrl(baseUrl)}/api/driver/queue?driverId=${encodeURIComponent(driverId)}`
  );
  if (!response.ok) throw new Error(`queue fetch failed ${response.status}`);
  const data = await response.json();
  return data.queue as DriverQueueItem[];
}

export async function cancelDriverDelivery(queueItemId: string, driverId: string, baseUrl?: string): Promise<void> {
  const response = await fetch(`${resolveBaseUrl(baseUrl)}/api/driver/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ queueItemId, driverId }),
  });
  if (!response.ok) throw new Error(`driver cancel failed ${response.status}`);
}

export async function confirmCustomerRequest(requestId: string, driverId: string, baseUrl?: string): Promise<void> {
  const response = await fetch(`${resolveBaseUrl(baseUrl)}/api/requests/admin/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId, driverId }),
  });
  if (!response.ok) throw new Error(`confirm failed ${response.status}`);
}

export async function denyCustomerRequest(requestId: string, baseUrl?: string): Promise<void> {
  const response = await fetch(`${resolveBaseUrl(baseUrl)}/api/requests/admin/deny`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId }),
  });
  if (!response.ok) throw new Error(`deny failed ${response.status}`);
}

export async function pushDeliveryToDriver(requestId: string, baseUrl?: string): Promise<void> {
  const response = await fetch(`${resolveBaseUrl(baseUrl)}/api/requests/admin/push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId }),
  });
  if (!response.ok) throw new Error(`push failed ${response.status}`);
}

export async function adminCancelDelivery(requestId: string, baseUrl?: string): Promise<void> {
  const response = await fetch(`${resolveBaseUrl(baseUrl)}/api/requests/admin/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId }),
  });
  if (!response.ok) throw new Error(`admin cancel failed ${response.status}`);
}

export async function closeDriverNotification(notificationId: string, baseUrl?: string): Promise<void> {
  const response = await fetch(`${resolveBaseUrl(baseUrl)}/api/driver/notifications/close`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ notificationId }),
  });
  if (!response.ok) {
    throw new Error(`notification close failed with status ${response.status}`);
  }
}

export async function archiveDriverPhotosToServer(
  submission: DriverPhotoArchiveSubmission,
  baseUrl?: string
): Promise<void> {
  const response = await fetch(`${resolveBaseUrl(baseUrl)}/api/driver/photo-archive`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(submission),
  });

  if (!response.ok) {
    throw new Error(`photo archive failed with status ${response.status}`);
  }
}
