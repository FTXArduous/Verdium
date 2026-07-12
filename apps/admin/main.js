const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { app, BrowserWindow, dialog, ipcMain } = require('electron');

// Avoid GPU/media decode instability on some Windows deployments.
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');

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
let ffmpegRepairState = {
  repaired: false,
  sourcePath: '',
  error: '',
};
let wifiSimulationMode = false;
let simulatedAdminProfile = null;
let terminalServerProcess = null;

function createSimulatedAdminProfile() {
  const simulationId = `${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
  return {
    email: `admin-${simulationId}@fakeemail.com`,
    password: 'WifiSimulation!2026',
    displayName: 'Simulated Admin',
    role: 'admin',
    storeLocation: 'Williamsburg',
    documents: [],
  };
}

function getTerminalHostAddresses() {
  const addresses = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === 'IPv4' && !entry.internal) {
        addresses.push(`http://${entry.address}:4010`);
      }
    }
  }
  return [...new Set(addresses)];
}

function getTerminalServerPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'server-cache', 'server.js');
  }
  return path.join(__dirname, '..', '..', 'packages', 'server-cache', 'src', 'server.js');
}

function startTerminalServer() {
  if (terminalServerProcess && !terminalServerProcess.killed) {
    return;
  }

  const serverPath = getTerminalServerPath();
  if (!fs.existsSync(serverPath)) {
    appendLogLine(`[admin] terminal-server missing path=${serverPath}`);
    return;
  }

  terminalServerProcess = spawn(process.execPath, [serverPath], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      VERDIUM_CACHE_PORT: '4010',
      VERDIUM_CACHE_HOST: '0.0.0.0',
      VERDIUM_CACHE_DATA_DIR: path.join(app.getPath('userData'), 'terminal-cache'),
      VERDIUM_LOCAL_ONLY: 'true',
      VERDIUM_TERMINAL_NAME: 'Verdium Terminal',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  terminalServerProcess.stdout.on('data', (data) => appendLogLine(`[admin] terminal-server ${String(data).trim()}`));
  terminalServerProcess.stderr.on('data', (data) => appendLogLine(`[admin] terminal-server-error ${String(data).trim()}`));
  terminalServerProcess.on('exit', (code) => {
    appendLogLine(`[admin] terminal-server exited code=${code}`);
    terminalServerProcess = null;
  });
  appendLogLine(`[admin] terminal-server started path=${serverPath}`);
}

function stopTerminalServer() {
  if (terminalServerProcess && !terminalServerProcess.killed) {
    terminalServerProcess.kill();
  }
  terminalServerProcess = null;
}

function getMediaRuntimeState() {
  const ffmpegPath = path.join(path.dirname(process.execPath), 'ffmpeg.dll');
  const ffmpegExists = fs.existsSync(ffmpegPath);
  const ffmpegSize = ffmpegExists ? fs.statSync(ffmpegPath).size : 0;
  return { ffmpegPath, ffmpegExists, ffmpegSize };
}

function getFfmpegCandidatePaths() {
  const execDir = path.dirname(process.execPath);
  const resourcesPath = process.resourcesPath || '';
  return [
    path.join(execDir, 'resources', 'ffmpeg.dll'),
    resourcesPath ? path.join(resourcesPath, 'ffmpeg.dll') : '',
    path.join(__dirname, 'node_modules', 'electron', 'dist', 'ffmpeg.dll'),
    path.join(__dirname, '..', '..', 'node_modules', 'electron', 'dist', 'ffmpeg.dll'),
  ].filter(Boolean);
}

function tryRepairFfmpegIfMissing() {
  const mediaState = getMediaRuntimeState();
  if (mediaState.ffmpegExists) {
    ffmpegRepairState = { repaired: false, sourcePath: '', error: '' };
    return mediaState;
  }

  for (const candidatePath of getFfmpegCandidatePaths()) {
    try {
      if (!fs.existsSync(candidatePath)) {
        continue;
      }
      fs.copyFileSync(candidatePath, mediaState.ffmpegPath);
      const repairedState = getMediaRuntimeState();
      if (repairedState.ffmpegExists) {
        ffmpegRepairState = {
          repaired: true,
          sourcePath: candidatePath,
          error: '',
        };
        appendLogLine(`[admin] ffmpeg repair success source=${candidatePath}`);
        return repairedState;
      }
    } catch (error) {
      ffmpegRepairState = {
        repaired: false,
        sourcePath: candidatePath,
        error: error?.message || 'copy failed',
      };
      appendLogLine(`[admin] ffmpeg repair failed source=${candidatePath} reason=${ffmpegRepairState.error}`);
    }
  }

  return getMediaRuntimeState();
}

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

function logMediaRuntimeState() {
  const { ffmpegPath, ffmpegExists, ffmpegSize } = getMediaRuntimeState();
  appendLogLine(`[admin] media ffmpeg path=${ffmpegPath} exists=${ffmpegExists} size=${ffmpegSize}`);
}

async function checkApiStartupState(apiBaseUrl) {
  if (!apiBaseUrl) {
    return {
      configured: false,
      reachable: false,
      statusCode: 0,
      reason: 'VERDIUM_API_BASE_URL is not configured.',
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);

  try {
    const response = await fetch(`${apiBaseUrl}/api/profiles?email=startup-check`, {
      method: 'GET',
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return {
      configured: true,
      reachable: response.ok,
      statusCode: response.status,
      reason: response.ok
        ? 'API reachable.'
        : `API responded with status ${response.status}.`,
    };
  } catch (error) {
    clearTimeout(timeout);
    return {
      configured: true,
      reachable: false,
      statusCode: 0,
      reason: `API unreachable: ${error?.message || 'network error'}`,
    };
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

  if (wifiSimulationMode) {
    const profile = simulatedAdminProfile || createSimulatedAdminProfile();
    simulatedAdminProfile = profile;
    appendLogLine(`[admin] simulated login ${profile.email}`);
    return {
      ok: true,
      profile,
      reason: 'Wi-Fi simulation mode is active. Server functions are disabled.',
    };
  }

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

ipcMain.handle('verdium-set-wifi-simulation', (_event, enabled) => {
  wifiSimulationMode = Boolean(enabled);
  simulatedAdminProfile = wifiSimulationMode ? createSimulatedAdminProfile() : null;
  if (wifiSimulationMode) {
    startTerminalServer();
  } else {
    stopTerminalServer();
  }
  appendLogLine(`[admin] wifi-simulation ${wifiSimulationMode ? 'enabled' : 'disabled'}`);
  return {
    enabled: wifiSimulationMode,
    profile: simulatedAdminProfile,
    terminalHosts: getTerminalHostAddresses(),
  };
});

ipcMain.handle('verdium-terminal-network', async () => {
  let devices = [];
  if (wifiSimulationMode) {
    try {
      const response = await fetch('http://127.0.0.1:4010/api/terminal/devices');
      const payload = await response.json();
      devices = Array.isArray(payload.devices) ? payload.devices : [];
    } catch (_error) {
      // The child server may still be starting.
    }
  }
  return {
    enabled: wifiSimulationMode,
    running: Boolean(terminalServerProcess && !terminalServerProcess.killed),
    hosts: getTerminalHostAddresses(),
    devices,
  };
});

ipcMain.handle('verdium-startup-health', async () => {
  if (wifiSimulationMode) {
    const mediaState = getMediaRuntimeState();
    return {
      apiBaseUrl: '',
      apiConfigured: false,
      apiReachable: false,
      apiStatusCode: 0,
      apiReason: 'Wi-Fi simulation mode is active. Server functions are disabled.',
      ffmpegPath: mediaState.ffmpegPath,
      ffmpegExists: mediaState.ffmpegExists,
      ffmpegSize: mediaState.ffmpegSize,
      ffmpegRepaired: ffmpegRepairState.repaired,
      ffmpegRepairSource: ffmpegRepairState.sourcePath,
      ffmpegRepairError: ffmpegRepairState.error,
      wifiSimulationMode: true,
      simulatedProfile: simulatedAdminProfile,
    };
  }

  const apiBaseUrl = getApiBaseUrl();
  const apiState = await checkApiStartupState(apiBaseUrl);
  const mediaState = getMediaRuntimeState();

  if (!apiState.reachable) {
    appendLogLine(`[admin] startup-warning ${apiState.reason}`);
  }
  if (!mediaState.ffmpegExists) {
    appendLogLine('[admin] startup-warning ffmpeg.dll missing or unreadable');
  }

  return {
    apiBaseUrl,
    apiConfigured: apiState.configured,
    apiReachable: apiState.reachable,
    apiStatusCode: apiState.statusCode,
    apiReason: apiState.reason,
    ffmpegPath: mediaState.ffmpegPath,
    ffmpegExists: mediaState.ffmpegExists,
    ffmpegSize: mediaState.ffmpegSize,
    ffmpegRepaired: ffmpegRepairState.repaired,
    ffmpegRepairSource: ffmpegRepairState.sourcePath,
    ffmpegRepairError: ffmpegRepairState.error,
    wifiSimulationMode: false,
    simulatedProfile: null,
  };
});

app.whenReady().then(() => {
  appendLogLine('[admin] app started');
  const mediaState = tryRepairFfmpegIfMissing();
  if (!mediaState.ffmpegExists) {
    appendLogLine(`[admin] startup-warning ffmpeg.dll missing path=${mediaState.ffmpegPath}`);
    dialog.showMessageBox({
      type: 'warning',
      buttons: ['Continue'],
      defaultId: 0,
      title: 'Verdium Admin Startup Warning',
      message: 'ffmpeg.dll is missing. The app will continue, but media features may fail.',
      detail: `Expected path: ${mediaState.ffmpegPath}\nFix: run the app from the full unpacked release folder, not only the EXE file.`,
    }).catch(() => {
      // Keep startup non-blocking even if dialog display fails.
    });
  }
  logMediaRuntimeState();
  createWindow();
});

process.on('uncaughtException', (error) => {
  appendLogLine(`[admin] uncaught ${error?.message || 'unknown'}`);
});

process.on('unhandledRejection', (reason) => {
  appendLogLine(`[admin] unhandled ${String(reason || 'unknown')}`);
});

app.on('window-all-closed', () => {
  stopTerminalServer();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
