const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // existing
  onHighlightDropped: (callback) => {
    ipcRenderer.removeAllListeners('highlight-dropped');
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

  // Viewer pane docking: the shell streams its viewer slot's rectangle and
  // visibility; main applies them to the native browser view.
  paneSetBounds: (rect) => ipcRenderer.send('pane:set-bounds', rect),
  paneSetVisible: (visible) => ipcRenderer.send('pane:set-visible', visible),

  // Browser chrome (URL bar / nav buttons rendered by the shell).
  // Region clipping over the live browser page.
  clipStart: () => ipcRenderer.send('clip:start'),
  onClipCaptured: (callback) => {
    ipcRenderer.removeAllListeners('clip:captured');
    ipcRenderer.on('clip:captured', (_event, data) => callback(data));
  },
  onClipCancelled: (callback) => {
    ipcRenderer.removeAllListeners('clip:cancelled');
    ipcRenderer.on('clip:cancelled', (_event, data) => callback(data));
  },

  // PDF import: native picker, or import a dropped file by absolute path.
  pdfOpen: () => ipcRenderer.invoke('pdf:open'),
  pdfDelete: (file) => ipcRenderer.invoke('pdf:delete', file),
  // Absolute path of a dropped File (sandbox-safe replacement for File.path).
  pathForFile: (file) => webUtils.getPathForFile(file),
  pdfImport: (absPath) => ipcRenderer.invoke('pdf:import', absPath),
  // Persist a renderer-cropped PNG (PDF clip) into the clips store.
  clipSave: (payload) => ipcRenderer.invoke('clip:save', payload),

  browserNavigate: (input) => ipcRenderer.send('browser:navigate', input),
  browserBack: () => ipcRenderer.send('browser:back'),
  browserForward: () => ipcRenderer.send('browser:forward'),
  browserReload: () => ipcRenderer.send('browser:reload'),
  onBrowserState: (callback) => {
    ipcRenderer.removeAllListeners('browser:state');
    ipcRenderer.on('browser:state', (_event, data) => callback(data));
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
  onHighlightRemove: (callback) => {
    ipcRenderer.removeAllListeners('capture:highlight-remove');
    ipcRenderer.on('capture:highlight-remove', (_event, data) => callback(data));
  },
  // Reverse sync: main asks for highlights on a URL; renderer answers.
  onHighlightsRequest: (callback) => {
    ipcRenderer.removeAllListeners('capture:highlights-request');
    ipcRenderer.on('capture:highlights-request', (_event, data) => callback(data));
  },
  respondHighlights: (reqId, items) => {
    ipcRenderer.send('capture:highlights-response', { reqId, items });
  },
});

console.log('Preload script loaded');
