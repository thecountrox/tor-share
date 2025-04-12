const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const { startTor, stopTor, getTorStatus } = require("./tor");
const SignalingServer = require("./signaling");
const ClientManager = require("./p2p");
const fs = require("fs-extra");

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require("electron-squirrel-startup")) {
  app.quit();
}

let mainWindow;
let torDataDir;
let signalingServer;
let clientManager;

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1024,
    height: 768,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "../preload.js"),
    },
  });

  mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  mainWindow.webContents.openDevTools();
};

app.on("ready", async () => {
  createWindow();

  // Create temporary directory for Tor data
  torDataDir = path.join(app.getPath("temp"), "tor-share");
  await fs.ensureDir(torDataDir);

  // Start Tor
  await startTor(torDataDir);

  // Start signaling server
  signalingServer = new SignalingServer();
  await signalingServer.start(torDataDir);

  // Get onion address
  const onionAddress = signalingServer.getOnionAddress();
  if (!onionAddress) {
    throw new Error("Failed to get onion address");
  }

  // Initialize client manager
  clientManager = new ClientManager();

  // Set up event handlers
  clientManager.on("ready", (clientId) => {
    mainWindow.webContents.send("peer-ready", clientId);
  });

  clientManager.on("clients", (clients) => {
    mainWindow.webContents.send("peer-list", clients);
  });

  clientManager.on("transfer-request", (data) => {
    mainWindow.webContents.send("transfer-request", data);
  });

  clientManager.on("transfer-accepted", (clientId) => {
    mainWindow.webContents.send("transfer-accepted", clientId);
  });

  clientManager.on("transfer-rejected", (clientId) => {
    mainWindow.webContents.send("transfer-rejected", clientId);
  });

  clientManager.on("transfer-progress", (data) => {
    mainWindow.webContents.send("transfer-progress", data);
  });

  clientManager.on("client-disconnected", (clientId) => {
    mainWindow.webContents.send("peer-disconnected", clientId);
  });

  clientManager.on("error", (error) => {
    mainWindow.webContents.send("error", error);
  });

  // Connect to signaling server
  await clientManager.connect(onionAddress);
});

app.on("window-all-closed", async () => {
  if (process.platform !== "darwin") {
    if (clientManager) {
      await clientManager.disconnect();
    }
    if (signalingServer) {
      await signalingServer.stop();
    }
    await stopTor();
    await fs.remove(torDataDir);
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// IPC handlers
ipcMain.handle("start-tor", async () => {
  await startTor(torDataDir);
  return getTorStatus();
});

ipcMain.handle("stop-tor", async () => {
  await stopTor();
  return getTorStatus();
});

ipcMain.handle("status-tor", () => {
  return getTorStatus();
});

ipcMain.handle("select-file", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile"],
  });
  return result.filePaths[0];
});

ipcMain.handle("send-file", async (event, clientId, filePath) => {
  await clientManager.sendFile(clientId, filePath);
});

ipcMain.handle("refresh-peers", async () => {
  if (clientManager && clientManager.socket) {
    clientManager.socket.emit("discover");
  }
});

ipcMain.handle("respond-to-transfer", async (event, clientId, accept) => {
  clientManager.respondToTransfer(clientId, accept);
});
