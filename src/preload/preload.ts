import { contextBridge, ipcRenderer } from 'electron';

// Minimal, promise-based bridge. The renderer never touches Node APIs.
contextBridge.exposeInMainWorld('nfAPI', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings: unknown) => ipcRenderer.invoke('settings:set', settings),
  getHighScores: () => ipcRenderer.invoke('scores:get'),
  saveHighScores: (scores: unknown) => ipcRenderer.invoke('scores:set', scores),
  setFullscreen: (flag: boolean) => ipcRenderer.invoke('window:fullscreen', flag),
});
