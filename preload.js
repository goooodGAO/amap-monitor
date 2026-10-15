'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getState: () => ipcRenderer.invoke('get-state'),
  checkNow: () => ipcRenderer.invoke('check-now'),
  openLogin: () => ipcRenderer.invoke('open-login'),
  logout: () => ipcRenderer.invoke('logout'),
  saveConfig: (cfg) => ipcRenderer.invoke('save-config', cfg),
  testNotify: (channel) => ipcRenderer.invoke('test-notify', channel),
  getHistory: () => ipcRenderer.invoke('get-history'),
  onState: (cb) => ipcRenderer.on('state-updated', (e, s) => cb(s)),
});
