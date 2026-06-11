const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, ipcMain } = require('electron');

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
  const ok = email === 'admin@verdium.example' && password === 'VerdiumAdmin!2026';
  appendLogLine(`[admin] login ${ok ? 'success' : 'failure'} ${email}`);
  return ok;
});

ipcMain.handle('verdium-config', () => {
  const apiBaseUrl = String(process.env.VERDIUM_API_BASE_URL || '').trim().replace(/\/$/, '');
  return {
    apiBaseUrl,
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
