const fs = require('fs');
const http = require('http');
const path = require('path');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }
  const text = fs.readFileSync(filePath, 'utf8');
  text.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      return;
    }
    const eq = trimmed.indexOf('=');
    if (eq < 1) {
      return;
    }
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  });
}

loadEnvFile(path.join(__dirname, '..', '.env'));
loadEnvFile(path.join(__dirname, '..', '..', '..', '.env'));

const PORT = Number(process.env.VERDIUM_CACHE_PORT || 4010);
const HOST = String(process.env.VERDIUM_CACHE_HOST || '0.0.0.0').trim();
const DB_DIR = String(process.env.VERDIUM_CACHE_DATA_DIR || path.join(__dirname, '..', '.cache')).trim();
const DB_FILE = path.join(DB_DIR, 'deliveries.json');
const SUPABASE_URL = String(process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || '').trim().replace(/\/$/, '');
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const SUPABASE_PROFILE_BUCKET = String(process.env.SUPABASE_PROFILE_BUCKET || 'profile-images').trim();
const USE_SUPABASE = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY && process.env.VERDIUM_LOCAL_ONLY !== 'true');
const OFFER_WINDOW_MS = 10_000;
const DEFAULT_DRIVER_IDS = ['driver-1', 'driver-2', 'driver-3'];
const assignmentLocks = new Set();

function ensureDb() {
  fs.mkdirSync(DB_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(
      DB_FILE,
      JSON.stringify({ deliveries: [], customerRequests: [], driverNotifications: [], driverPings: [], driverQueue: [], cancelLog: [], driverPhotoArchive: [], profiles: [], terminalDevices: [] }, null, 2),
      'utf8'
    );
  }
}

function readDb() {
  ensureDb();
  return normalizeDb(JSON.parse(fs.readFileSync(DB_FILE, 'utf8')));
}

function writeDb(data) {
  ensureDb();
  fs.writeFileSync(DB_FILE, JSON.stringify(normalizeDb(data), null, 2), 'utf8');
}

function normalizeDb(data) {
  return {
    deliveries: Array.isArray(data.deliveries) ? data.deliveries : [],
    customerRequests: Array.isArray(data.customerRequests) ? data.customerRequests : [],
    driverNotifications: Array.isArray(data.driverNotifications) ? data.driverNotifications : [],
    driverPings: Array.isArray(data.driverPings) ? data.driverPings : [],
    driverQueue: Array.isArray(data.driverQueue) ? data.driverQueue : [],
    cancelLog: Array.isArray(data.cancelLog) ? data.cancelLog : [],
    driverPhotoArchive: Array.isArray(data.driverPhotoArchive) ? data.driverPhotoArchive : [],
    profiles: Array.isArray(data.profiles) ? data.profiles : [],
    terminalDevices: Array.isArray(data.terminalDevices) ? data.terminalDevices : [],
  };
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(payload));
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function sanitizeUploadPath(value) {
  return String(value || '')
    .replace(/[^a-zA-Z0-9/_\-.]/g, '_')
    .replace(/\.{2,}/g, '.')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/');
}

async function uploadProfileImageToSupabase(imageBase64, mimeType, folder, fileName) {
  if (!USE_SUPABASE) {
    return `data:${mimeType};base64,${imageBase64}`;
  }

  const cleanFolder = sanitizeUploadPath(folder || 'profiles');
  const cleanFileName = sanitizeUploadPath(fileName || `profile-${Date.now()}.jpg`);
  const objectPath = `${cleanFolder}/${Date.now()}-${cleanFileName}`;
  const uploadUrl = `${SUPABASE_URL}/storage/v1/object/${SUPABASE_PROFILE_BUCKET}/${objectPath}`;
  const binary = Buffer.from(String(imageBase64 || ''), 'base64');

  const response = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': String(mimeType || 'image/jpeg'),
      'x-upsert': 'true',
    },
    body: binary,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`profile image upload failed ${response.status}: ${text}`);
  }

  return `${SUPABASE_URL}/storage/v1/object/public/${SUPABASE_PROFILE_BUCKET}/${objectPath}`;
}

function createDeliveryRecord(body) {
  const now = new Date().toISOString();
  return {
    id: `evt_${Date.now()}`,
    orderId: String(body.orderId || ''),
    address: String(body.address || ''),
    elapsedSeconds: Number(body.elapsedSeconds || 0),
    imageUri: String(body.imageUri || ''),
    createdAt: now,
    deliveredAt: now,
    status: 'delivered',
  };
}

function createCustomerRequestRecord(body) {
  const now = new Date().toISOString();
  return {
    id: `req_${Date.now()}`,
    customerId: String(body.customerId || 'customer'),
    address: String(body.address || ''),
    hashSerial: String(body.hashSerial || '').replace(/\s+/g, '').toUpperCase(),
    qrToken: String(body.qrToken || ''),
    createdAt: now,
    status: 'pending',
    offerAttemptedDriverIds: [],
    offerExpiresAt: '',
  };
}

function createDriverNotification(body) {
  const now = new Date().toISOString();
  return {
    id: `ntf_${Date.now()}`,
    driverId: String(body.driverId || ''),
    requestId: String(body.requestId || ''),
    message: String(body.message || 'Admin requested a delivery.'),
    address: String(body.address || ''),
    createdAt: now,
    closed: false,
  };
}

function createProfileRecord(body) {
  const now = new Date().toISOString();
  return {
    id: `profile_${Date.now()}`,
    email: String(body.email || '').trim().toLowerCase(),
    password: String(body.password || ''),
    displayName: String(body.displayName || body.email || 'Profile'),
    role: String(body.role || 'customer'),
    storeLocation: String(body.storeLocation || 'Williamsburg'),
    licenseImageUri: String(body.licenseImageUri || ''),
    insuranceImageUri: String(body.insuranceImageUri || ''),
    deliveryImageUri: String(body.deliveryImageUri || ''),
    vehicleImageUri: String(body.vehicleImageUri || ''),
    deliveryData: String(body.deliveryData || ''),
    documents: Array.isArray(body.documents) ? body.documents : [],
    createdAt: now,
    updatedAt: now,
  };
}

function normalizeProfile(profile) {
  return {
    id: String(profile.id || `profile_${Date.now()}`),
    email: String(profile.email || '').trim().toLowerCase(),
    password: String(profile.password || ''),
    displayName: String(profile.displayName || profile.email || 'Profile'),
    role: String(profile.role || 'customer'),
    storeLocation: String(profile.storeLocation || 'Williamsburg'),
    licenseImageUri: String(profile.licenseImageUri || ''),
    insuranceImageUri: String(profile.insuranceImageUri || ''),
    deliveryImageUri: String(profile.deliveryImageUri || ''),
    vehicleImageUri: String(profile.vehicleImageUri || ''),
    deliveryData: String(profile.deliveryData || ''),
    documents: Array.isArray(profile.documents) ? profile.documents : [],
    createdAt: String(profile.createdAt || new Date().toISOString()),
    updatedAt: String(profile.updatedAt || profile.createdAt || new Date().toISOString()),
  };
}

function toDbProfile(record) {
  return {
    id: record.id,
    email: record.email,
    password: record.password,
    display_name: record.displayName,
    role: record.role,
    store_location: record.storeLocation,
    license_image_uri: record.licenseImageUri,
    insurance_image_uri: record.insuranceImageUri,
    delivery_image_uri: record.deliveryImageUri,
    vehicle_image_uri: record.vehicleImageUri,
    delivery_data: record.deliveryData,
    documents: record.documents,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
  };
}

function fromDbProfile(row) {
  return normalizeProfile({
    id: row.id,
    email: row.email,
    password: row.password,
    displayName: row.display_name || row.displayName,
    role: row.role,
    storeLocation: row.store_location || row.storeLocation,
    licenseImageUri: row.license_image_uri || row.licenseImageUri,
    insuranceImageUri: row.insurance_image_uri || row.insuranceImageUri,
    deliveryImageUri: row.delivery_image_uri || row.deliveryImageUri,
    vehicleImageUri: row.vehicle_image_uri || row.vehicleImageUri,
    deliveryData: row.delivery_data || row.deliveryData,
    documents: row.documents || [],
    createdAt: row.created_at || row.createdAt,
    updatedAt: row.updated_at || row.updatedAt,
  });
}

function isValidDeliveryBody(body) {
  return Boolean(body && body.orderId && body.address && body.imageUri);
}

function isValidHashSerial(hashSerial) {
  return /^[A-Z0-9]{48}$/.test(String(hashSerial || '').replace(/\s+/g, '').toUpperCase());
}

function toDbDelivery(record) {
  return {
    id: record.id,
    order_id: record.orderId,
    address: record.address,
    elapsed_seconds: record.elapsedSeconds,
    image_uri: record.imageUri,
    created_at: record.createdAt,
    delivered_at: record.deliveredAt,
    status: record.status,
  };
}

function fromDbDelivery(row) {
  return {
    id: String(row.id),
    orderId: String(row.order_id || row.orderId || ''),
    address: String(row.address || ''),
    elapsedSeconds: Number(row.elapsed_seconds ?? row.elapsedSeconds ?? 0),
    imageUri: String(row.image_uri || row.imageUri || ''),
    createdAt: String(row.created_at || row.createdAt || ''),
    deliveredAt: String(row.delivered_at || row.deliveredAt || ''),
    status: 'delivered',
  };
}

function toDbRequest(record) {
  return {
    id: record.id,
    customer_id: record.customerId,
    address: record.address,
    hash_serial: record.hashSerial,
    qr_token: record.qrToken,
    created_at: record.createdAt,
    status: record.status,
    dispatched_to: record.dispatchedTo || null,
    confirmed_driver_id: record.confirmedDriverId || null,
    hash_locked: Boolean(record.hashLocked),
    offer_attempted_driver_ids: Array.isArray(record.offerAttemptedDriverIds) ? record.offerAttemptedDriverIds : [],
    offer_expires_at: record.offerExpiresAt || null,
  };
}

function fromDbRequest(row) {
  return {
    id: String(row.id),
    customerId: String(row.customer_id || row.customerId || 'customer'),
    address: String(row.address || ''),
    hashSerial: String(row.hash_serial || row.hashSerial || '').replace(/\s+/g, '').toUpperCase(),
    qrToken: String(row.qr_token || row.qrToken || ''),
    createdAt: String(row.created_at || row.createdAt || ''),
    status: String(row.status || 'pending'),
    dispatchedTo: row.dispatched_to || row.dispatchedTo || undefined,
    confirmedDriverId: row.confirmed_driver_id || row.confirmedDriverId || undefined,
    hashLocked: Boolean(row.hash_locked ?? row.hashLocked),
    offerAttemptedDriverIds: Array.isArray(row.offer_attempted_driver_ids)
      ? row.offer_attempted_driver_ids
      : (Array.isArray(row.offerAttemptedDriverIds) ? row.offerAttemptedDriverIds : []),
    offerExpiresAt: String(row.offer_expires_at || row.offerExpiresAt || ''),
  };
}

function toDbNotification(record) {
  return {
    id: record.id,
    driver_id: record.driverId,
    request_id: record.requestId,
    message: record.message,
    address: record.address,
    created_at: record.createdAt,
    closed: Boolean(record.closed),
  };
}

function fromDbNotification(row) {
  return {
    id: String(row.id),
    driverId: String(row.driver_id || row.driverId || ''),
    requestId: String(row.request_id || row.requestId || ''),
    message: String(row.message || ''),
    address: String(row.address || ''),
    createdAt: String(row.created_at || row.createdAt || ''),
    closed: Boolean(row.closed),
  };
}

function toDbPing(record) {
  return {
    id: record.id,
    driver_id: record.driverId,
    label: record.label,
    created_at: record.createdAt,
    fee: record.fee,
  };
}

function fromDbPing(row) {
  return {
    id: String(row.id),
    driverId: String(row.driver_id || row.driverId || ''),
    label: String(row.label || ''),
    createdAt: String(row.created_at || row.createdAt || ''),
    fee: Number(row.fee || 0),
  };
}

function toDbQueueItem(record) {
  return {
    id: record.id,
    request_id: record.requestId,
    driver_id: record.driverId,
    address: record.address,
    hash_serial: record.hashSerial,
    qr_token: record.qrToken,
    created_at: record.createdAt,
    status: record.status,
  };
}

function fromDbQueueItem(row) {
  return {
    id: String(row.id),
    requestId: String(row.request_id || row.requestId || ''),
    driverId: String(row.driver_id || row.driverId || ''),
    address: String(row.address || ''),
    hashSerial: String(row.hash_serial || row.hashSerial || '').replace(/\s+/g, '').toUpperCase(),
    qrToken: String(row.qr_token || row.qrToken || ''),
    createdAt: String(row.created_at || row.createdAt || ''),
    status: String(row.status || 'queued'),
  };
}

function toDbCancelLog(record) {
  return {
    id: record.id,
    request_id: record.requestId,
    queue_item_id: record.queueItemId || null,
    cancelled_by: record.cancelledBy,
    created_at: record.createdAt,
  };
}

function fromDbCancelLog(row) {
  return {
    id: String(row.id),
    requestId: String(row.request_id || row.requestId || ''),
    queueItemId: row.queue_item_id || row.queueItemId || undefined,
    cancelledBy: String(row.cancelled_by || row.cancelledBy || ''),
    createdAt: String(row.created_at || row.createdAt || ''),
  };
}

function toDbDriverPhotoArchive(record) {
  return {
    id: record.id,
    driver_id: record.driverId,
    session_id: record.sessionId,
    photo_phase: record.phase,
    label: record.label,
    image_uri: record.imageUri,
    created_at: record.createdAt,
    archived_at: record.archivedAt,
  };
}

function fromDbDriverPhotoArchive(row) {
  return {
    id: String(row.id),
    driverId: String(row.driver_id || row.driverId || ''),
    sessionId: String(row.session_id || row.sessionId || ''),
    phase: String(row.photo_phase || row.phase || 'during-trip'),
    label: String(row.label || ''),
    imageUri: String(row.image_uri || row.imageUri || ''),
    createdAt: String(row.created_at || row.createdAt || ''),
    archivedAt: String(row.archived_at || row.archivedAt || ''),
  };
}

async function supabaseRequest(table, options = {}) {
  if (!USE_SUPABASE) {
    throw new Error('Supabase is not configured');
  }

  const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
  const headers = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: options.prefer || 'return=representation',
  };

  if (options.select) {
    url.searchParams.set('select', options.select);
  }
  if (options.query) {
    for (const [key, value] of Object.entries(options.query)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }
  }

  const response = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch (_error) {
    payload = text;
  }

  if (!response.ok) {
    const message = payload && typeof payload === 'object' && payload.message ? payload.message : `Supabase request failed ${response.status}`;
    throw new Error(message);
  }

  return payload;
}

async function listSupabaseDeliveries() {
  const rows = await supabaseRequest('deliveries', {
    select: '*',
    query: { order: 'created_at.desc' },
  });
  return (rows || []).map(fromDbDelivery);
}

async function insertSupabaseDelivery(record) {
  const rows = await supabaseRequest('deliveries', {
    method: 'POST',
    body: [toDbDelivery(record)],
  });
  return fromDbDelivery(rows[0]);
}

async function listSupabaseCustomerDeliveries() {
  const deliveries = await listSupabaseDeliveries();
  return deliveries.map((delivery) => ({
    orderId: delivery.orderId,
    address: delivery.address,
    imageUri: delivery.imageUri,
    deliveredAt: delivery.deliveredAt,
  }));
}

async function listSupabaseRequests(customerId) {
  const query = { order: 'created_at.desc' };
  if (customerId) {
    query.customer_id = `eq.${String(customerId).trim().toLowerCase()}`;
  }
  const rows = await supabaseRequest('customer_requests', {
    select: '*',
    query,
  });
  return (rows || []).map(fromDbRequest);
}

async function insertSupabaseRequest(record) {
  const rows = await supabaseRequest('customer_requests', {
    method: 'POST',
    body: [toDbRequest(record)],
  });
  return fromDbRequest(rows[0]);
}

async function updateSupabaseRequest(requestId, patch) {
  const rows = await supabaseRequest('customer_requests', {
    method: 'PATCH',
    query: { id: `eq.${requestId}` },
    body: patch,
  });
  return rows[0] ? fromDbRequest(rows[0]) : null;
}

async function listSupabaseNotifications(driverId) {
  const rows = await supabaseRequest('driver_notifications', {
    select: '*',
    query: { driver_id: `eq.${driverId}`, closed: 'eq.false', order: 'created_at.desc' },
  });
  return (rows || []).map(fromDbNotification);
}

async function insertSupabaseNotification(record) {
  const rows = await supabaseRequest('driver_notifications', {
    method: 'POST',
    body: [toDbNotification(record)],
  });
  return fromDbNotification(rows[0]);
}

async function closeSupabaseNotification(notificationId) {
  await supabaseRequest('driver_notifications', {
    method: 'PATCH',
    query: { id: `eq.${notificationId}` },
    body: { closed: true },
  });
}

async function insertSupabasePing(record) {
  const rows = await supabaseRequest('driver_pings', {
    method: 'POST',
    body: [toDbPing(record)],
  });
  return fromDbPing(rows[0]);
}

async function listSupabasePings() {
  const rows = await supabaseRequest('driver_pings', {
    select: '*',
    query: { order: 'created_at.desc' },
  });
  return (rows || []).map(fromDbPing);
}

async function insertSupabaseQueueItem(record) {
  const rows = await supabaseRequest('driver_queue', {
    method: 'POST',
    body: [toDbQueueItem(record)],
  });
  return fromDbQueueItem(rows[0]);
}

async function listSupabaseQueue(driverId) {
  const rows = await supabaseRequest('driver_queue', {
    select: '*',
    query: { driver_id: `eq.${driverId}`, status: 'eq.queued', order: 'created_at.desc' },
  });
  return (rows || []).map(fromDbQueueItem);
}

async function cancelSupabaseQueueItem(queueItemId) {
  await supabaseRequest('driver_queue', {
    method: 'PATCH',
    query: { id: `eq.${queueItemId}` },
    body: { status: 'cancelled' },
  });
}

async function insertSupabaseCancelLog(record) {
  const rows = await supabaseRequest('cancel_log', {
    method: 'POST',
    body: [toDbCancelLog(record)],
  });
  return fromDbCancelLog(rows[0]);
}

async function listSupabaseCancelLog() {
  const rows = await supabaseRequest('cancel_log', {
    select: '*',
    query: { order: 'created_at.desc' },
  });
  return (rows || []).map(fromDbCancelLog);
}

async function insertSupabaseDriverPhotoArchive(records) {
  const rows = await supabaseRequest('driver_photo_archive', {
    method: 'POST',
    body: records.map(toDbDriverPhotoArchive),
  });
  return (rows || []).map(fromDbDriverPhotoArchive);
}

async function listSupabaseProfiles(email) {
  const query = { order: 'created_at.desc' };
  if (email) {
    query.email = `eq.${email}`;
  }
  const rows = await supabaseRequest('profiles', {
    select: '*',
    query,
  });
  return (rows || []).map(fromDbProfile);
}

async function insertSupabaseProfile(record) {
  const rows = await supabaseRequest('profiles', {
    method: 'POST',
    body: [toDbProfile(record)],
  });
  return fromDbProfile(rows[0]);
}

async function updateSupabaseProfile(email, patch) {
  const rows = await supabaseRequest('profiles', {
    method: 'PATCH',
    query: { email: `eq.${email}` },
    body: patch,
  });
  return rows[0] ? fromDbProfile(rows[0]) : null;
}

async function getStore() {
  if (USE_SUPABASE) {
    return {
      async insertDelivery(record) {
        return insertSupabaseDelivery(record);
      },
      async listDeliveries() {
        return listSupabaseDeliveries();
      },
      async listCustomerDeliveries() {
        return listSupabaseCustomerDeliveries();
      },
      async insertRequest(record) {
        return insertSupabaseRequest(record);
      },
      async listRequests(customerId) {
        return listSupabaseRequests(customerId);
      },
      async updateRequest(requestId, patch) {
        return updateSupabaseRequest(requestId, patch);
      },
      async insertNotification(record) {
        return insertSupabaseNotification(record);
      },
      async listNotifications(driverId) {
        return listSupabaseNotifications(driverId);
      },
      async closeNotification(notificationId) {
        return closeSupabaseNotification(notificationId);
      },
      async insertPing(record) {
        return insertSupabasePing(record);
      },
      async listPings() {
        return listSupabasePings();
      },
      async insertQueueItem(record) {
        return insertSupabaseQueueItem(record);
      },
      async listQueue(driverId) {
        return listSupabaseQueue(driverId);
      },
      async cancelQueueItem(queueItemId) {
        return cancelSupabaseQueueItem(queueItemId);
      },
      async insertCancelLog(record) {
        return insertSupabaseCancelLog(record);
      },
      async listCancelLog() {
        return listSupabaseCancelLog();
      },
      async insertDriverPhotoArchive(records) {
        return insertSupabaseDriverPhotoArchive(records);
      },
      async listProfiles(email) {
        return listSupabaseProfiles(email);
      },
      async insertProfile(record) {
        return insertSupabaseProfile(record);
      },
      async updateProfile(email, patch) {
        return updateSupabaseProfile(email, patch);
      },
    };
  }

  return {
    async insertDelivery(record) {
      const db = readDb();
      const stored = { ...record };
      db.deliveries.unshift(stored);
      writeDb(db);
      return stored;
    },
    async listDeliveries() {
      return readDb().deliveries;
    },
    async listCustomerDeliveries() {
      return readDb().deliveries.map((delivery) => ({
        orderId: delivery.orderId,
        address: delivery.address,
        imageUri: delivery.imageUri,
        deliveredAt: delivery.deliveredAt,
      }));
    },
    async insertRequest(record) {
      const db = readDb();
      const stored = { ...record };
      db.customerRequests.unshift(stored);
      writeDb(db);
      return stored;
    },
    async listRequests(customerId) {
      const requests = readDb().customerRequests;
      if (!customerId) {
        return requests;
      }
      const clean = String(customerId).trim().toLowerCase();
      return requests.filter((request) => request.customerId === clean);
    },
    async updateRequest(requestId, patch) {
      const db = readDb();
      const request = db.customerRequests.find((item) => item.id === requestId);
      if (!request) {
        return null;
      }
      Object.assign(request, patch);
      writeDb(db);
      return request;
    },
    async insertNotification(record) {
      const db = readDb();
      const stored = { ...record };
      db.driverNotifications.unshift(stored);
      writeDb(db);
      return stored;
    },
    async listNotifications(driverId) {
      return readDb().driverNotifications.filter((item) => item.driverId === driverId && !item.closed);
    },
    async closeNotification(notificationId) {
      const db = readDb();
      const notification = db.driverNotifications.find((item) => item.id === notificationId);
      if (notification) {
        notification.closed = true;
        writeDb(db);
      }
    },
    async insertPing(record) {
      const db = readDb();
      const stored = { ...record };
      db.driverPings.unshift(stored);
      writeDb(db);
      return stored;
    },
    async listPings() {
      return readDb().driverPings;
    },
    async insertQueueItem(record) {
      const db = readDb();
      const stored = { ...record };
      db.driverQueue.push(stored);
      writeDb(db);
      return stored;
    },
    async listQueue(driverId) {
      return readDb().driverQueue.filter((item) => item.driverId === driverId && item.status === 'queued');
    },
    async cancelQueueItem(queueItemId) {
      const db = readDb();
      const item = db.driverQueue.find((q) => q.id === queueItemId);
      if (item) {
        item.status = 'cancelled';
        writeDb(db);
      }
    },
    async insertCancelLog(record) {
      const db = readDb();
      const stored = { ...record };
      db.cancelLog.unshift(stored);
      writeDb(db);
      return stored;
    },
    async listCancelLog() {
      return readDb().cancelLog;
    },
    async insertDriverPhotoArchive(records) {
      const db = readDb();
      const stored = records.map((record) => ({ ...record }));
      db.driverPhotoArchive.unshift(...stored);
      writeDb(db);
      return stored;
    },
    async listProfiles(email) {
      const profiles = readDb().profiles;
      if (!email) {
        return profiles;
      }
      return profiles.filter((profile) => profile.email === String(email).trim().toLowerCase());
    },
    async insertProfile(record) {
      const db = readDb();
      const stored = { ...record };
      const index = db.profiles.findIndex((profile) => profile.email === stored.email);
      if (index >= 0) {
        db.profiles[index] = stored;
      } else {
        db.profiles.unshift(stored);
      }
      writeDb(db);
      return stored;
    },
    async updateProfile(email, patch) {
      const db = readDb();
      const profile = db.profiles.find((item) => item.email === String(email).trim().toLowerCase());
      if (!profile) {
        return null;
      }
      Object.assign(profile, patch, { updatedAt: new Date().toISOString() });
      writeDb(db);
      return profile;
    },
  };
}

async function closeRequestNotifications(store, driverId, requestId) {
  const notifications = await store.listNotifications(driverId);
  await Promise.all(
    notifications
      .filter((notification) => notification.requestId === requestId)
      .map((notification) => store.closeNotification(notification.id))
  );
}

async function nextDriverForRequest(store, attemptedDriverIds) {
  const pings = await store.listPings();
  const recentDriverIds = [...new Set(
    pings
      .filter((ping) => Date.now() - new Date(ping.createdAt).getTime() < 5 * 60 * 1000)
      .map((ping) => ping.driverId)
      .filter(Boolean)
  )];
  const eligibleDriverIds = (recentDriverIds.length > 0 ? recentDriverIds : DEFAULT_DRIVER_IDS)
    .filter((driverId) => !attemptedDriverIds.includes(driverId));

  if (eligibleDriverIds.length === 0) {
    return '';
  }

  const loads = await Promise.all(eligibleDriverIds.map(async (driverId) => ({
    driverId,
    count: (await store.listQueue(driverId)).length,
  })));
  loads.sort((left, right) => left.count - right.count || left.driverId.localeCompare(right.driverId));
  return loads[0].driverId;
}

async function offerRequestToNextDriver(store, request) {
  const attemptedDriverIds = Array.isArray(request.offerAttemptedDriverIds) ? request.offerAttemptedDriverIds : [];
  const driverId = await nextDriverForRequest(store, attemptedDriverIds);
  if (!driverId) {
    return store.updateRequest(request.id, {
      status: 'awaiting-driver',
      dispatchedTo: '',
      offerExpiresAt: '',
    });
  }

  const offerExpiresAt = new Date(Date.now() + OFFER_WINDOW_MS).toISOString();
  const updatedRequest = await store.updateRequest(request.id, {
    status: 'offered',
    dispatchedTo: driverId,
    offerAttemptedDriverIds: [...attemptedDriverIds, driverId],
    offerExpiresAt,
  });
  await store.insertNotification(createDriverNotification({
    driverId,
    requestId: request.id,
    message: 'New delivery request. Accept within 10 seconds.',
    address: request.address,
  }));
  return updatedRequest;
}

async function expireDriverOffers(store) {
  const requests = await store.listRequests();
  const now = Date.now();
  for (const request of requests) {
    if (request.status !== 'offered' || !request.offerExpiresAt || new Date(request.offerExpiresAt).getTime() > now) {
      continue;
    }
    await closeRequestNotifications(store, String(request.dispatchedTo || ''), request.id);
    await offerRequestToNextDriver(store, request);
  }
}

const server = http.createServer(async (req, res) => {
  if (!req.url || !req.method) {
    sendJson(res, 400, { error: 'invalid request' });
    return;
  }

  const store = await getStore();

  if (req.method === 'OPTIONS') {
    sendJson(res, 204, { ok: true });
    return;
  }

  if (req.url === '/health') {
    sendJson(res, 200, { ok: true, service: 'verdium-server-cache', backend: USE_SUPABASE ? 'supabase' : 'local-file' });
    return;
  }

  if (req.method === 'GET' && req.url === '/api/terminal/devices') {
    const devices = readDb().terminalDevices;
    sendJson(res, 200, { terminalName: process.env.VERDIUM_TERMINAL_NAME || 'Verdium Terminal', devices });
    return;
  }

  if (req.method === 'POST' && req.url === '/api/terminal/devices') {
    try {
      const body = await parseJsonBody(req);
      const deviceId = String(body.deviceId || '').trim();
      const name = String(body.deviceName || '').trim();
      const role = String(body.role || '').trim();
      if (!deviceId || !name || (role !== 'customer' && role !== 'driver')) {
        sendJson(res, 422, { error: 'deviceId, deviceName, and customer or driver role are required' });
        return;
      }
      const db = readDb();
      const ipAddress = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
      const device = { id: deviceId, name, role, ipAddress, connectedAt: new Date().toISOString() };
      const index = db.terminalDevices.findIndex((item) => item.id === deviceId);
      if (index >= 0) {
        db.terminalDevices[index] = device;
      } else {
        db.terminalDevices.unshift(device);
      }
      writeDb(db);
      sendJson(res, 200, { terminalName: process.env.VERDIUM_TERMINAL_NAME || 'Verdium Terminal', devices: db.terminalDevices });
    } catch (_error) {
      sendJson(res, 400, { error: 'invalid json body' });
    }
    return;
  }

  if (req.method === 'POST' && req.url === '/api/deliveries') {
    try {
      const body = await parseJsonBody(req);
      if (!isValidDeliveryBody(body)) {
        sendJson(res, 422, { error: 'orderId, address, and imageUri are required' });
        return;
      }
      const record = createDeliveryRecord(body);
      const stored = await store.insertDelivery(record);
      sendJson(res, 201, { ok: true, delivery: stored });
    } catch (error) {
      sendJson(res, 400, { error: 'invalid json body' });
    }
    return;
  }

  if (req.method === 'POST' && req.url === '/api/uploads/profile-image') {
    try {
      const body = await parseJsonBody(req);
      const imageBase64 = String(body?.imageBase64 || '').trim();
      const mimeType = String(body?.mimeType || 'image/jpeg').trim();
      const fileName = String(body?.fileName || `profile-${Date.now()}.jpg`).trim();
      const folder = String(body?.folder || 'profiles').trim();

      if (!imageBase64) {
        sendJson(res, 422, { error: 'imageBase64 is required' });
        return;
      }

      const imageUri = await uploadProfileImageToSupabase(imageBase64, mimeType, folder, fileName);
      sendJson(res, 201, { imageUri });
    } catch (error) {
      sendJson(res, 400, { error: String(error?.message || error || 'upload failed') });
    }
    return;
  }

  if (req.method === 'GET' && req.url.startsWith('/api/profiles')) {
    const parsed = new URL(req.url, 'http://localhost');
    const email = parsed.searchParams.get('email') || '';
    const profiles = await store.listProfiles(email);
    sendJson(res, 200, { profiles });
    return;
  }

  if (req.method === 'POST' && req.url === '/api/profiles') {
    try {
      const body = await parseJsonBody(req);
      if (!body?.email || !body?.password || !body?.licenseImageUri || !body?.storeLocation) {
        sendJson(res, 422, { error: 'email, password, licenseImageUri, and storeLocation are required' });
        return;
      }
      const existing = await store.listProfiles(body.email);
      const record = createProfileRecord(body);
      const stored = existing.length > 0 ? await store.updateProfile(body.email, record) : await store.insertProfile(record);
      sendJson(res, 201, { ok: true, profile: stored || record });
    } catch (_error) {
      sendJson(res, 400, { error: 'invalid json body' });
    }
    return;
  }

  if (req.method === 'GET' && req.url === '/api/deliveries/admin') {
    const deliveries = await store.listDeliveries();
    sendJson(res, 200, { deliveries });
    return;
  }

  if (req.method === 'GET' && req.url === '/api/deliveries/customer') {
    const deliveries = await store.listCustomerDeliveries();
    sendJson(res, 200, { deliveries });
    return;
  }

  if (req.method === 'POST' && req.url === '/api/requests/customer') {
    try {
      const body = await parseJsonBody(req);
      if (!body?.address || !body?.qrToken || !isValidHashSerial(body?.hashSerial)) {
        sendJson(res, 422, { error: 'address, qrToken, and valid 48-char hashSerial are required' });
        return;
      }
      const record = createCustomerRequestRecord(body);
      const stored = await store.insertRequest(record);
      sendJson(res, 201, { ok: true, request: stored });
    } catch (_error) {
      sendJson(res, 400, { error: 'invalid json body' });
    }
    return;
  }

  if (req.method === 'GET' && req.url.startsWith('/api/requests/customer')) {
    const parsed = new URL(req.url, 'http://localhost');
    const customerId = parsed.searchParams.get('customerId') || '';
    const requests = await store.listRequests(customerId);
    sendJson(res, 200, { requests });
    return;
  }

  if (req.method === 'POST' && req.url === '/api/requests/customer/cancel') {
    try {
      const body = await parseJsonBody(req);
      if (!body?.requestId || !body?.customerId) {
        sendJson(res, 422, { error: 'requestId and customerId are required' });
        return;
      }
      const requests = await store.listRequests(String(body.customerId));
      const request = requests.find((item) => item.id === body.requestId && item.customerId === String(body.customerId).trim().toLowerCase());
      if (!request) {
        sendJson(res, 404, { error: 'request not found for this customer' });
        return;
      }
      await store.updateRequest(request.id, { status: 'cancelled', hashLocked: false });
      const queue = await store.listQueue(String(request.confirmedDriverId || request.dispatchedTo || ''));
      for (const item of queue.filter((item) => item.requestId === request.id)) {
        await store.cancelQueueItem(item.id);
      }
      await store.insertCancelLog({
        id: `cl_${Date.now()}`,
        requestId: request.id,
        cancelledBy: String(body.customerId).trim().toLowerCase(),
        createdAt: new Date().toISOString(),
      });
      sendJson(res, 200, { ok: true });
    } catch (_error) {
      sendJson(res, 400, { error: 'invalid json body' });
    }
    return;
  }

  if (req.method === 'GET' && req.url === '/api/requests/admin') {
    const requests = await store.listRequests();
    sendJson(res, 200, { requests });
    return;
  }

  if (req.method === 'POST' && req.url === '/api/requests/admin/confirm') {
    try {
      const body = await parseJsonBody(req);
      if (!body?.requestId || !body?.driverId) {
        sendJson(res, 422, { error: 'requestId and driverId are required' });
        return;
      }
      const confirmedRequest = await store.updateRequest(body.requestId, {
        status: 'confirmed',
        confirmedDriverId: String(body.driverId),
        hashLocked: true,
      });
      if (!confirmedRequest) {
        sendJson(res, 404, { error: 'request not found' });
        return;
      }
      const request = await offerRequestToNextDriver(store, {
        ...confirmedRequest,
        offerAttemptedDriverIds: [],
      });
      sendJson(res, 200, { ok: true, request });
    } catch (_error) {
      sendJson(res, 400, { error: 'invalid json body' });
    }
    return;
  }

  if (req.method === 'POST' && req.url === '/api/requests/admin/deny') {
    try {
      const body = await parseJsonBody(req);
      if (!body?.requestId) {
        sendJson(res, 422, { error: 'requestId required' });
        return;
      }
      const request = await store.updateRequest(body.requestId, { status: 'denied' });
      if (!request) {
        sendJson(res, 404, { error: 'request not found' });
        return;
      }
      sendJson(res, 200, { ok: true });
    } catch (_error) {
      sendJson(res, 400, { error: 'invalid json body' });
    }
    return;
  }

  if (req.method === 'POST' && req.url === '/api/requests/admin/push') {
    try {
      const body = await parseJsonBody(req);
      if (!body?.requestId) {
        sendJson(res, 422, { error: 'requestId required' });
        return;
      }
      const requests = await store.listRequests();
      const request = requests.find((item) => item.id === body.requestId);
      if (!request || !['confirmed', 'awaiting-driver'].includes(request.status)) {
        sendJson(res, 422, { error: 'request must be confirmed before dispatch' });
        return;
      }
      const offered = await offerRequestToNextDriver(store, { ...request, offerAttemptedDriverIds: [] });
      sendJson(res, 201, { ok: true, request: offered });
    } catch (_error) {
      sendJson(res, 400, { error: 'invalid json body' });
    }
    return;
  }

  if (req.method === 'POST' && req.url === '/api/requests/admin/cancel') {
    try {
      const body = await parseJsonBody(req);
      if (!body?.requestId) {
        sendJson(res, 422, { error: 'requestId required' });
        return;
      }
      const requests = await store.listRequests();
      const request = requests.find((item) => item.id === body.requestId);
      if (request) {
        await store.updateRequest(body.requestId, { status: 'cancelled', hashLocked: false });
      }
      const queue = await store.listQueue(String(request?.confirmedDriverId || request?.dispatchedTo || ''));
      for (const item of queue.filter((item) => item.requestId === body.requestId)) {
        await store.cancelQueueItem(item.id);
      }
      await store.insertCancelLog({
        id: `cl_${Date.now()}`,
        requestId: body.requestId,
        cancelledBy: 'terminal',
        createdAt: new Date().toISOString(),
      });
      sendJson(res, 200, { ok: true });
    } catch (_error) {
      sendJson(res, 400, { error: 'invalid json body' });
    }
    return;
  }

  if (req.method === 'GET' && req.url.startsWith('/api/driver/queue')) {
    const parsed = new URL(req.url, 'http://cache.internal');
    const driverId = parsed.searchParams.get('driverId') || '';
    const queue = await store.listQueue(driverId);
    sendJson(res, 200, { queue });
    return;
  }

  if (req.method === 'GET' && req.url.startsWith('/api/driver/offers')) {
    const parsed = new URL(req.url, 'http://cache.internal');
    const driverId = parsed.searchParams.get('driverId') || '';
    await expireDriverOffers(store);
    const requests = await store.listRequests();
    const offers = requests.filter((request) => (
      request.status === 'offered'
      && request.dispatchedTo === driverId
      && new Date(request.offerExpiresAt).getTime() > Date.now()
    ));
    sendJson(res, 200, { offers });
    return;
  }

  if (req.method === 'POST' && req.url === '/api/driver/offers/accept') {
    let lockedRequestId = '';
    try {
      const body = await parseJsonBody(req);
      if (!body?.requestId || !body?.driverId) {
        sendJson(res, 422, { error: 'requestId and driverId required' });
        return;
      }
      lockedRequestId = String(body.requestId);
      if (assignmentLocks.has(lockedRequestId)) {
        sendJson(res, 409, { error: 'delivery is being accepted by another driver' });
        return;
      }
      assignmentLocks.add(lockedRequestId);
      await expireDriverOffers(store);
      const requests = await store.listRequests();
      const request = requests.find((item) => item.id === body.requestId);
      if (!request || request.status !== 'offered' || request.dispatchedTo !== body.driverId) {
        sendJson(res, 409, { error: 'offer is no longer available' });
        return;
      }
      const queue = await store.listQueue(String(body.driverId));
      if (queue.some((item) => item.requestId === request.id)) {
        sendJson(res, 409, { error: 'delivery already accepted' });
        return;
      }
      const queueItem = await store.insertQueueItem({
        id: `q_${Date.now()}`,
        requestId: request.id,
        driverId: String(body.driverId),
        address: request.address,
        hashSerial: request.hashSerial,
        qrToken: request.qrToken,
        createdAt: new Date().toISOString(),
        status: 'queued',
      });
      const updatedRequest = await store.updateRequest(request.id, {
        status: 'pushed',
        confirmedDriverId: String(body.driverId),
        dispatchedTo: String(body.driverId),
        offerExpiresAt: '',
        hashLocked: true,
      });
      await closeRequestNotifications(store, String(body.driverId), request.id);
      sendJson(res, 201, { ok: true, queueItem, request: updatedRequest });
    } catch (_error) {
      sendJson(res, 400, { error: 'invalid json body' });
    } finally {
      if (lockedRequestId) {
        assignmentLocks.delete(lockedRequestId);
      }
    }
    return;
  }

  if (req.method === 'POST' && req.url === '/api/driver/offers/decline') {
    try {
      const body = await parseJsonBody(req);
      if (!body?.requestId || !body?.driverId) {
        sendJson(res, 422, { error: 'requestId and driverId required' });
        return;
      }
      const requests = await store.listRequests();
      const request = requests.find((item) => item.id === body.requestId && item.dispatchedTo === body.driverId && item.status === 'offered');
      if (!request) {
        sendJson(res, 409, { error: 'offer is no longer available' });
        return;
      }
      await closeRequestNotifications(store, String(body.driverId), request.id);
      const nextRequest = await offerRequestToNextDriver(store, request);
      sendJson(res, 200, { ok: true, request: nextRequest });
    } catch (_error) {
      sendJson(res, 400, { error: 'invalid json body' });
    }
    return;
  }

  if (req.method === 'GET' && req.url.startsWith('/api/driver/cancelled')) {
    const parsed = new URL(req.url, 'http://cache.internal');
    const driverId = parsed.searchParams.get('driverId') || '';
    const requests = await store.listRequests();
    const cancelled = requests
      .filter((request) => request.status === 'cancelled')
      .map((request) => ({ ...request, available: !request.confirmedDriverId || request.confirmedDriverId === driverId }));
    sendJson(res, 200, { cancelled });
    return;
  }

  if (req.method === 'POST' && req.url === '/api/driver/cancelled/claim') {
    let lockedRequestId = '';
    try {
      const body = await parseJsonBody(req);
      if (!body?.requestId || !body?.driverId) {
        sendJson(res, 422, { error: 'requestId and driverId required' });
        return;
      }
      lockedRequestId = String(body.requestId);
      if (assignmentLocks.has(lockedRequestId)) {
        sendJson(res, 409, { error: 'delivery is being selected by another driver' });
        return;
      }
      assignmentLocks.add(lockedRequestId);
      const requests = await store.listRequests();
      const request = requests.find((item) => item.id === body.requestId);
      if (!request || request.status !== 'cancelled') {
        sendJson(res, 409, { error: 'cancelled delivery is no longer available' });
        return;
      }
      const queueItem = await store.insertQueueItem({
        id: `q_${Date.now()}`,
        requestId: request.id,
        driverId: String(body.driverId),
        address: request.address,
        hashSerial: request.hashSerial,
        qrToken: request.qrToken,
        createdAt: new Date().toISOString(),
        status: 'queued',
      });
      const updatedRequest = await store.updateRequest(request.id, {
        status: 'pushed',
        confirmedDriverId: String(body.driverId),
        dispatchedTo: String(body.driverId),
        hashLocked: true,
      });
      sendJson(res, 201, { ok: true, queueItem, request: updatedRequest });
    } catch (_error) {
      sendJson(res, 400, { error: 'invalid json body' });
    } finally {
      if (lockedRequestId) {
        assignmentLocks.delete(lockedRequestId);
      }
    }
    return;
  }

  if (req.method === 'POST' && req.url === '/api/driver/cancel') {
    try {
      const body = await parseJsonBody(req);
      if (!body?.queueItemId || !body?.driverId) {
        sendJson(res, 422, { error: 'queueItemId and driverId required' });
        return;
      }
      const queue = await store.listQueue(String(body.driverId));
      const item = queue.find((q) => q.id === body.queueItemId && q.driverId === body.driverId);
      if (!item) {
        sendJson(res, 404, { error: 'queue item not found for this driver' });
        return;
      }
      await store.cancelQueueItem(item.id);
      const requests = await store.listRequests();
      const request = requests.find((r) => r.id === item.requestId);
      if (request) {
        await store.updateRequest(request.id, { status: 'cancelled', hashLocked: false });
      }
      await store.insertCancelLog({
        id: `cl_${Date.now()}`,
        requestId: item.requestId,
        queueItemId: item.id,
        cancelledBy: body.driverId,
        createdAt: new Date().toISOString(),
      });
      sendJson(res, 200, { ok: true });
    } catch (_error) {
      sendJson(res, 400, { error: 'invalid json body' });
    }
    return;
  }

  if (req.method === 'GET' && req.url === '/api/admin/cancel-log') {
    const cancelLog = await store.listCancelLog();
    sendJson(res, 200, { cancelLog });
    return;
  }

  if (req.method === 'POST' && req.url === '/api/requests/admin/dispatch') {
    try {
      const body = await parseJsonBody(req);
      if (!body?.requestId || !body?.driverId) {
        sendJson(res, 422, { error: 'requestId and driverId are required' });
        return;
      }

      const requests = await store.listRequests();
      const request = requests.find((item) => item.id === body.requestId);
      if (!request) {
        sendJson(res, 404, { error: 'request not found' });
        return;
      }

      await store.updateRequest(request.id, {
        status: 'dispatched',
        dispatchedTo: String(body.driverId),
      });

      const notification = await store.insertNotification(createDriverNotification({
        driverId: body.driverId,
        requestId: body.requestId,
        message: body.message,
        address: request.address,
      }));

      sendJson(res, 201, { ok: true, notification });
    } catch (_error) {
      sendJson(res, 400, { error: 'invalid json body' });
    }
    return;
  }

  if (req.method === 'GET' && req.url.startsWith('/api/driver/notifications')) {
    const parsed = new URL(req.url, 'http://cache.internal');
    const driverId = parsed.searchParams.get('driverId') || '';
    const notifications = await store.listNotifications(driverId);
    sendJson(res, 200, { notifications });
    return;
  }

  if (req.method === 'POST' && req.url === '/api/driver/notifications/close') {
    try {
      const body = await parseJsonBody(req);
      if (!body?.notificationId) {
        sendJson(res, 422, { error: 'notificationId required' });
        return;
      }
      await store.closeNotification(body.notificationId);
      sendJson(res, 200, { ok: true });
    } catch (_error) {
      sendJson(res, 400, { error: 'invalid json body' });
    }
    return;
  }

  if (req.method === 'POST' && req.url === '/api/driver/photo-archive') {
    try {
      const body = await parseJsonBody(req);
      if (!body?.driverId || !body?.sessionId || !Array.isArray(body?.photos)) {
        sendJson(res, 422, { error: 'driverId, sessionId, and photos array are required' });
        return;
      }

      const archivedAt = new Date().toISOString();
      const records = body.photos
        .filter((photo) => photo?.imageUri)
        .map((photo, index) => ({
          id: `dpa_${Date.now()}_${index}`,
          driverId: String(body.driverId),
          sessionId: String(body.sessionId),
          phase: String(photo.phase || 'during-trip'),
          label: String(photo.label || 'Driver photo'),
          imageUri: String(photo.imageUri || ''),
          createdAt: String(photo.createdAt || archivedAt),
          archivedAt,
        }));

      if (records.length === 0) {
        sendJson(res, 422, { error: 'at least one photo is required' });
        return;
      }

      const stored = await store.insertDriverPhotoArchive(records);
      sendJson(res, 201, { ok: true, archived: stored });
    } catch (_error) {
      sendJson(res, 400, { error: 'invalid json body' });
    }
    return;
  }

  if (req.method === 'POST' && req.url === '/api/driver/ping') {
    try {
      const body = await parseJsonBody(req);
      if (!body?.driverId) {
        sendJson(res, 422, { error: 'driverId required' });
        return;
      }
      const ping = await store.insertPing({
        id: `ping_${Date.now()}`,
        driverId: String(body.driverId),
        label: String(body.label || body.driverId),
        createdAt: new Date().toISOString(),
        fee: 0.01,
      });
      sendJson(res, 201, { ok: true, ping });
    } catch (_error) {
      sendJson(res, 400, { error: 'invalid json body' });
    }
    return;
  }

  if (req.method === 'GET' && req.url === '/api/driver/pings') {
    const pings = await store.listPings();
    sendJson(res, 200, { pings });
    return;
  }

  sendJson(res, 404, { error: 'not found' });
});

server.listen(PORT, HOST, () => {
  console.log(`Verdium server-cache listening on ${HOST}:${PORT} using ${USE_SUPABASE ? 'Supabase' : 'local file'} storage`);
});