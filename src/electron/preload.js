import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('myAPI', {
  // Expose APIs here if needed
});