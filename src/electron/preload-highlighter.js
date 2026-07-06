const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // existing drag APIs
  sendDragText: (data) => ipcRenderer.send('drag-drop-text-selection', data),
  sendDragPosition: (data) => ipcRenderer.send('drag-drop-text-position', data),
  sendDragEnd: (data) => ipcRenderer.send('drag-drop-text-end', data),

  // region clipping (the injected overlay reports back through these)
  clipRegion: (rect) => ipcRenderer.send('clip:region', rect),
  clipCancel: () => ipcRenderer.send('clip:cancel'),

  // new persistence APIs
  loadHighlights: (url) => ipcRenderer.invoke('highlights:load', { url }),
  saveHighlight: (highlight) => ipcRenderer.invoke('highlights:save', highlight),
  deleteHighlight: (id) => ipcRenderer.invoke('highlights:delete', { id }),
  listTags: () => ipcRenderer.invoke('tags:list'),

  // broadcast listeners
  onHighlightUpdated: (callback) => {
    ipcRenderer.removeAllListeners('highlight:updated');
    ipcRenderer.on('highlight:updated', (_event, data) => callback(data));
  },
  onHighlightDeleted: (callback) => {
    ipcRenderer.removeAllListeners('highlight:deleted');
    ipcRenderer.on('highlight:deleted', (_event, data) => callback(data));
  },
});

console.log('Preload-highlighter script loaded');
