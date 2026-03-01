// import { contextBridge, ipcRenderer } from 'electron';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Expose APIs here if needed
  sendTextSelection: (data) => {
    ipcRenderer.send('text-selection', data);
  },
  sendDragText: (data) => {
    ipcRenderer.send('drag-drop-text-selection', data);
    console.log('Sent drag-drop text selection:', data);
  },
  sendDragPosition: (data) => {
    ipcRenderer.send('drag-drop-text-position', data);
  },
  sendDragEnd: (data) => {
    ipcRenderer.send('drag-drop-text-end', data);
  },
});

console.log('Preload script loaded');