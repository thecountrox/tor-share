// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts
//

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electron", {
  // Client operations
  getClientId: () => ipcRenderer.invoke("get-client-id"),
  getConnectedClients: () => ipcRenderer.invoke("get-connected-clients"),
  sendFile: (targetClientId, filePath) => 
    ipcRenderer.invoke("send-file", { targetClientId, filePath }),
  acceptTransfer: (fromClientId, fileName) => 
    ipcRenderer.invoke("accept-transfer", { fromClientId, fileName }),
  rejectTransfer: (fromClientId) => 
    ipcRenderer.invoke("reject-transfer", { fromClientId }),

  // File operations
  selectFile: () => ipcRenderer.invoke("select-file"),

  // Signaling server configuration
  setSignalingServer: (url) => ipcRenderer.invoke("set-signaling-server", url),
  getSignalingServer: () => ipcRenderer.invoke("get-signaling-server"),

  // Event listeners
  onClientReady: (callback) => {
    ipcRenderer.on("client-ready", (_, clientId) => callback(clientId));
    return () => ipcRenderer.removeAllListeners("client-ready");
  },
  onClientsUpdated: (callback) => {
    ipcRenderer.on("clients-updated", (_, clients) => callback(clients));
    return () => ipcRenderer.removeAllListeners("clients-updated");
  },
  onClientDisconnected: (callback) => {
    ipcRenderer.on("client-disconnected", (_, clientId) => callback(clientId));
    return () => ipcRenderer.removeAllListeners("client-disconnected");
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
  onTransferComplete: (callback) => {
    ipcRenderer.on("transfer-complete", (_, data) => callback(data));
    return () => ipcRenderer.removeAllListeners("transfer-complete");
  },
  onTransferError: (callback) => {
    ipcRenderer.on("transfer-error", (_, data) => callback(data));
    return () => ipcRenderer.removeAllListeners("transfer-error");
  },
  onDisconnected: (callback) => {
    ipcRenderer.on("disconnected", () => callback());
    return () => ipcRenderer.removeAllListeners("disconnected");
  }
});
