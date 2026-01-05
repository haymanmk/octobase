import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // Expose APIs here if needed
  sendTextSelection: (data) => {
    ipcRenderer.send('text-selection', data);
  }
});
