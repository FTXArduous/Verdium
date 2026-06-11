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

function resolveBaseUrl(baseUrl?: string) {
  const maybeGlobal = globalThis as {
    process?: { env?: Record<string, string | undefined> };
    __VERDIUM_API_BASE_URL__?: string;
  };

  const envUrl = maybeGlobal.process?.env?.EXPO_PUBLIC_VERDIUM_API_BASE_URL || maybeGlobal.__VERDIUM_API_BASE_URL__;
  const resolved = String(baseUrl || envUrl || '').trim().replace(/\/$/, '');

  if (!resolved) {
    throw new Error('VERDIUM API base URL is not configured. Set EXPO_PUBLIC_VERDIUM_API_BASE_URL.');
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
  status: 'pending' | 'dispatched';
  dispatchedTo?: string;
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
