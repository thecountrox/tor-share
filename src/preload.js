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

  // Peer connections
  connectPeer: (peerId) => ipcRenderer.invoke("connect-peer", peerId),

  // File operations
  selectFile: () => ipcRenderer.invoke("select-file"),
  sendFile: (peerId, filePath) => ipcRenderer.invoke("send-file", peerId, filePath),

  // Event listeners
  onSelfId: (callback) => {
    ipcRenderer.on("peer-ready", (_, peerId) => callback(peerId));
    return () => ipcRenderer.removeAllListeners("peer-ready");
  },
  onPeerList: (callback) => {
    ipcRenderer.on("peer-list", (_, peers) => callback(peers));
    return () => ipcRenderer.removeAllListeners("peer-list");
  },
  onPeerConnected: (callback) => {
    ipcRenderer.on("channel-open", (_, peerId) => callback(peerId));
    return () => ipcRenderer.removeAllListeners("channel-open");
  },
  onTransferProgress: (callback) => {
    ipcRenderer.on("transfer-progress", (_, data) => callback(data));
    return () => ipcRenderer.removeAllListeners("transfer-progress");
  },
  onTransferComplete: (callback) => {
    ipcRenderer.on("transfer-complete", (_, data) => callback(data));
    return () => ipcRenderer.removeAllListeners("transfer-complete");
  },
  refreshPeers: () => ipcRenderer.invoke("refresh-peers"),
  onFileReceiveStart: (callback) => {
    ipcRenderer.on("file-receive-start", (_, data) => callback(data));
    return () => ipcRenderer.removeAllListeners("file-receive-start");
  },
  onTransferError: (callback) => {
    ipcRenderer.on("transfer-error", (_, data) => callback(data));
    return () => ipcRenderer.removeAllListeners("transfer-error");
  }
});
