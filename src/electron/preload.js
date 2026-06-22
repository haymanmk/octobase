const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // existing
  onHighlightDropped: (callback) => {
    ipcRenderer.on('highlight-dropped', (_event, data) => callback(data));
  },
  removeHighlightDroppedListener: () => {
    ipcRenderer.removeAllListeners('highlight-dropped');
  },

  // new card APIs
  loadCards: () => ipcRenderer.invoke('cards:load'),
  saveCard: (card) => ipcRenderer.invoke('cards:save', card),
  deleteCard: (id) => ipcRenderer.invoke('cards:delete', { id }),

  // broadcast listeners
  onCardUpdated: (callback) => {
    ipcRenderer.removeAllListeners('card:updated');
    ipcRenderer.on('card:updated', (_event, data) => callback(data));
  },
  onCardDeleted: (callback) => {
    ipcRenderer.removeAllListeners('card:deleted');
    ipcRenderer.on('card:deleted', (_event, data) => callback(data));
  },
});

// Bridge for the Chrome capture extension: the localhost server runs in the
// main process and forwards captures/highlights to this (left) renderer.
contextBridge.exposeInMainWorld('octobaseCapture', {
  getInfo: () => ipcRenderer.invoke('extension:info'),
  onCapture: (callback) => {
    ipcRenderer.removeAllListeners('capture:received');
    ipcRenderer.on('capture:received', (_event, data) => callback(data));
  },
  onHighlight: (callback) => {
    ipcRenderer.removeAllListeners('highlight:received');
    ipcRenderer.on('highlight:received', (_event, data) => callback(data));
  },
});

console.log('Preload script loaded');
