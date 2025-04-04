// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts
//

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electron", {
  startTor: () => ipcRenderer.invoke("startTor"),
  stopTor: () => ipcRenderer.invoke("stopTor"),
  statusTor: () => ipcRenderer.invoke("statusTor"),
  connectTor: () => ipcRenderer.invoke("connectTor"),
  getRequest: (url) => ipcRenderer.invoke("getRequest", url),
});
