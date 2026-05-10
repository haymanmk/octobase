const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlayAPI', {
  onDragText: (callback) => {
    ipcRenderer.removeAllListeners('drag-drop-text-selection');
    ipcRenderer.on('drag-drop-text-selection', (event, data) => {
      callback(data);
    });
  },
  onDragPosition: (callback) => {
    // Remove any stale listeners from previous drags
    ipcRenderer.removeAllListeners('drag-position-update');
    ipcRenderer.on('drag-position-update', (event, data) => {
      callback(data);
    });
  },
  onDragEnd: (callback) => {
    // Remove any stale listeners from previous drags
    ipcRenderer.removeAllListeners('drag-end');
    ipcRenderer.on('drag-end', (event) => {
      callback();
    });
  },
  sendDrop: (data) => {
    ipcRenderer.send('highlight-dropped', data);
  },
});