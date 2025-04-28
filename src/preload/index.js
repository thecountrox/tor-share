const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  // Client management
  getConnectedClients: () => ipcRenderer.invoke('get-connected-clients'),
  refreshClients: () => ipcRenderer.invoke('refresh-clients'),
  onClientsUpdated: (callback) => {
    const handler = (_, clients) => {
      console.log(`Preload: Received clients-updated event with ${clients.length} clients, forwarding to renderer`);
      callback(clients);
    };
    ipcRenderer.on('clients-updated', handler);
    return () => ipcRenderer.removeListener('clients-updated', handler);
  },

  // File selection
  selectFile: () => ipcRenderer.invoke('select-file'),

  // File transfer
  sendFile: (targetClientId, filePath) => 
    ipcRenderer.invoke('send-file', { targetClientId, filePath }),
  acceptTransfer: (fromClientId, fileName) =>
    ipcRenderer.invoke('accept-transfer', { fromClientId, fileName }),
  rejectTransfer: (fromClientId) =>
    ipcRenderer.invoke('reject-transfer', { fromClientId }),

  // Transfer events
  onTransferRequest: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('transfer-request', handler);
    return () => ipcRenderer.removeListener('transfer-request', handler);
  },
  onTransferProgress: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('transfer-progress', handler);
    return () => ipcRenderer.removeListener('transfer-progress', handler);
  },
  onTransferComplete: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('transfer-complete', handler);
    return () => ipcRenderer.removeListener('transfer-complete', handler);
  },
  onTransferError: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('transfer-error', handler);
    return () => ipcRenderer.removeListener('transfer-error', handler);
  },

  // Tor status
  onTorStatus: (callback) => {
    const handler = (_, status) => callback(status);
    ipcRenderer.on('tor-status', handler);
    return () => ipcRenderer.removeListener('tor-status', handler);
  },
  startTor: () => ipcRenderer.invoke('start-tor'),
  stopTor: () => ipcRenderer.invoke('stop-tor'),
  getTorStatus: () => ipcRenderer.invoke('status-tor'),

  // Error handling
  onError: (callback) => {
    const handler = (_, errorMessage) => callback(errorMessage);
    ipcRenderer.on('error', handler);
    return () => ipcRenderer.removeListener('error', handler);
  },

  // Signaling server
  onSignalingStatus: (callback) => {
    const handler = (_, status) => callback(status);
    ipcRenderer.on('signaling-status', handler);
    return () => ipcRenderer.removeListener('signaling-status', handler);
  },
  getSignalingServer: () => ipcRenderer.invoke('get-signaling-server'),
  setSignalingServer: (url) => ipcRenderer.invoke('set-signaling-server', url),
  onSignalingServerUrl: (callback) => {
    const handler = (_, url) => callback(url);
    ipcRenderer.on('signaling-server-url', handler);
    return () => ipcRenderer.removeListener('signaling-server-url', handler);
  },

  // Client ID
  getClientId: () => ipcRenderer.invoke('get-client-id'),
  onClientReady: (callback) => {
    const handler = (_, clientId) => callback(clientId);
    ipcRenderer.on('client-ready', handler);
    return () => ipcRenderer.removeListener('client-ready', handler);
  }
}); 