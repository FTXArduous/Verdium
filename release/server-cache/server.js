const fs = require('fs');
const http = require('http');
const path = require('path');

const PORT = Number(process.env.VERDIUM_CACHE_PORT || 4010);
const DB_DIR = path.join(__dirname, '..', '.cache');
const DB_FILE = path.join(DB_DIR, 'deliveries.json');

function ensureDb() {
  fs.mkdirSync(DB_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(
      DB_FILE,
      JSON.stringify({ deliveries: [], customerRequests: [], driverNotifications: [] }, null, 2),
      'utf8'
    );
  }
}

function readDb() {
  ensureDb();
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

function writeDb(data) {
  ensureDb();
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function normalizeDb(data) {
  return {
    deliveries: Array.isArray(data.deliveries) ? data.deliveries : [],
    customerRequests: Array.isArray(data.customerRequests) ? data.customerRequests : [],
    driverNotifications: Array.isArray(data.driverNotifications) ? data.driverNotifications : [],
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

function isValidDeliveryBody(body) {
  return Boolean(body && body.orderId && body.address && body.imageUri);
}

function isValidHashSerial(hashSerial) {
  return /^[A-Z0-9]{48}$/.test(String(hashSerial || '').replace(/\s+/g, '').toUpperCase());
}

const server = http.createServer(async (req, res) => {
  if (!req.url || !req.method) {
    sendJson(res, 400, { error: 'invalid request' });
    return;
  }

  if (req.method === 'OPTIONS') {
    sendJson(res, 204, { ok: true });
    return;
  }

  if (req.url === '/health') {
    sendJson(res, 200, { ok: true, service: 'verdium-server-cache' });
    return;
  }

  if (req.method === 'POST' && req.url === '/api/deliveries') {
    try {
      const body = await parseJsonBody(req);
      if (!isValidDeliveryBody(body)) {
        sendJson(res, 422, { error: 'orderId, address, and imageUri are required' });
        return;
      }
      const db = normalizeDb(readDb());
      const record = createDeliveryRecord(body);
      db.deliveries.unshift(record);
      writeDb(db);
      sendJson(res, 201, { ok: true, delivery: record });
    } catch (error) {
      sendJson(res, 400, { error: 'invalid json body' });
    }
    return;
  }

  if (req.method === 'GET' && req.url === '/api/deliveries/admin') {
    const db = normalizeDb(readDb());
    sendJson(res, 200, { deliveries: db.deliveries });
    return;
  }

  if (req.method === 'GET' && req.url === '/api/deliveries/customer') {
    const db = normalizeDb(readDb());
    const customerView = db.deliveries.map((delivery) => ({
      orderId: delivery.orderId,
      address: delivery.address,
      imageUri: delivery.imageUri,
      deliveredAt: delivery.deliveredAt,
    }));
    sendJson(res, 200, { deliveries: customerView });
    return;
  }

  if (req.method === 'POST' && req.url === '/api/requests/customer') {
    try {
      const body = await parseJsonBody(req);
      if (!body?.address || !body?.qrToken || !isValidHashSerial(body?.hashSerial)) {
        sendJson(res, 422, { error: 'address, qrToken, and valid 48-char hashSerial are required' });
        return;
      }
      const db = normalizeDb(readDb());
      const record = createCustomerRequestRecord(body);
      db.customerRequests.unshift(record);
      writeDb(db);
      sendJson(res, 201, { ok: true, request: record });
    } catch (_error) {
      sendJson(res, 400, { error: 'invalid json body' });
    }
    return;
  }

  if (req.method === 'GET' && req.url === '/api/requests/admin') {
    const db = normalizeDb(readDb());
    sendJson(res, 200, { requests: db.customerRequests });
    return;
  }

  if (req.method === 'POST' && req.url === '/api/requests/admin/dispatch') {
    try {
      const body = await parseJsonBody(req);
      if (!body?.requestId || !body?.driverId) {
        sendJson(res, 422, { error: 'requestId and driverId are required' });
        return;
      }

      const db = normalizeDb(readDb());
      const request = db.customerRequests.find((item) => item.id === body.requestId);
      if (!request) {
        sendJson(res, 404, { error: 'request not found' });
        return;
      }

      request.status = 'dispatched';
      request.dispatchedTo = String(body.driverId);

      const notification = createDriverNotification({
        driverId: body.driverId,
        requestId: body.requestId,
        message: body.message,
        address: request.address,
      });

      db.driverNotifications.unshift(notification);
      writeDb(db);
      sendJson(res, 201, { ok: true, notification });
    } catch (_error) {
      sendJson(res, 400, { error: 'invalid json body' });
    }
    return;
  }

  if (req.method === 'GET' && req.url.startsWith('/api/driver/notifications')) {
    const parsed = new URL(req.url, 'http://cache.internal');
    const driverId = parsed.searchParams.get('driverId') || '';
    const db = normalizeDb(readDb());
    const notifications = db.driverNotifications.filter((item) => item.driverId === driverId && !item.closed);
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
      const db = normalizeDb(readDb());
      const notification = db.driverNotifications.find((item) => item.id === body.notificationId);
      if (!notification) {
        sendJson(res, 404, { error: 'notification not found' });
        return;
      }
      notification.closed = true;
      writeDb(db);
      sendJson(res, 200, { ok: true });
    } catch (_error) {
      sendJson(res, 400, { error: 'invalid json body' });
    }
    return;
  }

  sendJson(res, 404, { error: 'not found' });
});

server.listen(PORT, () => {
  console.log(`Verdium server-cache listening on port ${PORT}`);
});
