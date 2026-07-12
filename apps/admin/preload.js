const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('verdiumAdmin', {
  logEvent(payload) {
    return ipcRenderer.invoke('verdium-log', payload);
  },
  login(credentials) {
    return ipcRenderer.invoke('verdium-login', credentials);
  },
  getConfig() {
    return ipcRenderer.invoke('verdium-config');
  },
  getStartupHealth() {
    return ipcRenderer.invoke('verdium-startup-health');
  },
});
