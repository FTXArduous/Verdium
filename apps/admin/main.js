const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, ipcMain } = require('electron');

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

loadEnvFile(path.join(__dirname, '.env'));
loadEnvFile(path.join(__dirname, '..', '..', '.env'));

let mainWindow;

function getLogTargets() {
  const appDataLogDir = path.join(app.getPath('appData'), 'Verdium Logs');
  const releaseLogDir = path.join(path.dirname(process.execPath), 'Verdium Logs');

  return [
    path.join(appDataLogDir, 'verdium.log'),
    path.join(releaseLogDir, 'verdium.log'),
  ];
}

function ensureParentDirs(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function appendLogLine(line) {
  const entry = `${new Date().toISOString()} ${line}\n`;
  for (const filePath of getLogTargets()) {
    ensureParentDirs(filePath);
    fs.appendFileSync(filePath, entry, 'utf8');
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    backgroundColor: '#14181c',
    title: 'Verdium Admin',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
}

function getApiBaseUrl() {
  return String(process.env.VERDIUM_API_BASE_URL || '').trim().replace(/\/$/, '');
}

ipcMain.handle('verdium-log', (_event, payload) => {
  const scope = payload?.scope || 'admin';
  const action = payload?.action || 'unknown';
  const detail = payload?.detail ? ` ${payload.detail}` : '';
  appendLogLine(`[${scope}] ${action}${detail}`);
  return true;
});

ipcMain.handle('verdium-login', (_event, credentials) => {
  const email = String(credentials?.email || '').trim().toLowerCase();
  const password = String(credentials?.password || '');
  const apiBaseUrl = getApiBaseUrl();

  if (apiBaseUrl) {
    return fetch(`${apiBaseUrl}/api/profiles?email=${encodeURIComponent(email)}`)
      .then((response) => response.ok ? response.json() : Promise.reject(new Error(`status ${response.status}`)))
      .then((payload) => {
        const profiles = Array.isArray(payload?.profiles) ? payload.profiles : [];
        const profile = profiles.find((item) => (
          String(item.email || '').trim().toLowerCase() === email
          && String(item.password || '') === password
          && String(item.role || '') === 'admin'
          && String(item.licenseImageUri || '').trim().length > 0
        )) || null;
        const ok = Boolean(profile);
        appendLogLine(`[admin] login ${ok ? 'success' : 'failure'} ${email}`);
        return {
          ok,
          profile,
          reason: ok ? '' : 'A terminal admin profile with a license image is required before sign in.',
        };
      })
      .catch((_error) => {
        appendLogLine(`[admin] login failure ${email}`);
        return {
          ok: false,
          profile: null,
          reason: 'Unable to verify terminal profile. Configure VERDIUM_API_BASE_URL and create a profile first.',
        };
      });
  }

  appendLogLine(`[admin] login failure ${email}`);
  return {
    ok: false,
    profile: null,
    reason: 'VERDIUM_API_BASE_URL is required. Create a terminal profile with a license image before sign in.',
  };
});

ipcMain.handle('verdium-config', () => {
  const apiBaseUrl = String(process.env.VERDIUM_API_BASE_URL || '').trim().replace(/\/$/, '');
  const googleMapsApiKey = String(process.env.VERDIUM_GOOGLE_MAPS_API_KEY || process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || '').trim();
  return {
    apiBaseUrl,
    googleMapsApiKey,
  };
});

app.whenReady().then(() => {
  appendLogLine('[admin] app started');
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
