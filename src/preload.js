// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts
//

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electron", {
  // Tor control
  startTor: () => ipcRenderer.invoke("start-tor"),
  stopTor: () => ipcRenderer.invoke("stop-tor"),
  statusTor: () => ipcRenderer.invoke("status-tor"),
  onTorStatus: (callback) => {
    ipcRenderer.on("tor-status", (_, status) => callback(status));
    return () => ipcRenderer.removeAllListeners("tor-status");
  },

  // File operations
  selectFile: () => ipcRenderer.invoke("select-file"),
  sendFile: (clientId, filePath) => ipcRenderer.invoke("send-file", clientId, filePath),
  respondToTransfer: (clientId, accept) => ipcRenderer.invoke("respond-to-transfer", clientId, accept),

  // Event listeners
  onSelfId: (callback) => {
    ipcRenderer.on("peer-ready", (_, clientId) => callback(clientId));
    return () => ipcRenderer.removeAllListeners("peer-ready");
  },
  onClientList: (callback) => {
    ipcRenderer.on("peer-list", (_, clients) => callback(clients));
    return () => ipcRenderer.removeAllListeners("peer-list");
  },
  onTransferRequest: (callback) => {
    ipcRenderer.on("transfer-request", (_, data) => callback(data));
    return () => ipcRenderer.removeAllListeners("transfer-request");
  },
  onTransferAccepted: (callback) => {
    ipcRenderer.on("transfer-accepted", (_, clientId) => callback(clientId));
    return () => ipcRenderer.removeAllListeners("transfer-accepted");
  },
  onTransferRejected: (callback) => {
    ipcRenderer.on("transfer-rejected", (_, clientId) => callback(clientId));
    return () => ipcRenderer.removeAllListeners("transfer-rejected");
  },
  onTransferProgress: (callback) => {
    ipcRenderer.on("transfer-progress", (_, data) => callback(data));
    return () => ipcRenderer.removeAllListeners("transfer-progress");
  },
  onClientDisconnected: (callback) => {
    ipcRenderer.on("peer-disconnected", (_, clientId) => callback(clientId));
    return () => ipcRenderer.removeAllListeners("peer-disconnected");
  },
  onError: (callback) => {
    ipcRenderer.on("error", (_, error) => callback(error));
    return () => ipcRenderer.removeAllListeners("error");
  },
  refreshClients: () => ipcRenderer.invoke("refresh-peers")
});
