const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const { startTor, stopTor, getTorStatus } = require("./tor");
const SignalingServer = require("./signaling");
const P2PManager = require("./p2p");
const fs = require("fs-extra");

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require("electron-squirrel-startup")) {
  app.quit();
}

let mainWindow;
let torDataDir;
let signalingServer;
let p2pManager;

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

const initializeApp = async () => {
  try {
    // Create temp directory for Tor data
    torDataDir = await fs.mkdtemp("/tmp/tor-");

    // Start Tor
    await startTor(torDataDir);
    mainWindow?.webContents.send("tor-status", "started");

    // Initialize P2P manager
    p2pManager = new P2PManager();
    await p2pManager.connect(
      "tfl5mirmj5griokqsfelbuinfoanjscuhvedxqrlhfivn7lmce5bjlid.onion",
    );

    // Set up event handlers
    p2pManager.on("ready", (peerId) => {
      mainWindow?.webContents.send("peer-ready", peerId);
    });

    p2pManager.on("peers", (peers) => {
      mainWindow?.webContents.send("peer-list", peers);
    });

    p2pManager.on("channel-open", (peerId) => {
      mainWindow?.webContents.send("channel-open", peerId);
    });

    p2pManager.on("transfer-progress", (data) => {
      mainWindow?.webContents.send("transfer-progress", data);
    });

    p2pManager.on("transfer-complete", (data) => {
      mainWindow?.webContents.send("transfer-complete", data);
    });

    p2pManager.on("file-receive-start", (data) => {
      mainWindow?.webContents.send("file-receive-start", data);
    });

    p2pManager.on("file-receive-complete", (data) => {
      mainWindow?.webContents.send("file-receive-complete", data);
    });

    p2pManager.on("error", (error) => {
      console.error("[DEBUG] P2P error:", error);
      mainWindow?.webContents.send("error", error);
    });

    p2pManager.on("transfer-error", (error) => {
      console.error("[DEBUG] Transfer error:", error);
      mainWindow?.webContents.send("transfer-error", error);
    });

  } catch (error) {
    console.error("Failed to initialize app:", error);
    mainWindow?.webContents.send("tor-status", "error");
    throw error;
  }
};

app.whenReady().then(() => {
  createWindow();
  initializeApp();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// IPC handlers
ipcMain.handle("start-tor", async () => {
  mainWindow?.webContents.send("tor-status", "starting");
  await startTor(torDataDir);
  const status = getTorStatus();
  mainWindow?.webContents.send("tor-status", status);
  return status;
});

ipcMain.handle("stop-tor", async () => {
  await stopTor();
  const status = getTorStatus();
  mainWindow?.webContents.send("tor-status", status);
  return status;
});

ipcMain.handle("status-tor", () => {
  return getTorStatus();
});

ipcMain.handle("connect-peer", async (event, peerId) => {
  try {
    await p2pManager.connectPeer(peerId);
    return true;
  } catch (error) {
    console.error("Failed to connect to peer:", error);
    throw error;
  }
});

ipcMain.handle("select-file", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile"],
  });

  if (!result.canceled && result.filePaths.length > 0) {
    const filePath = result.filePaths[0];
    const stats = await fs.stat(filePath);
    return {
      path: filePath,
      name: path.basename(filePath),
      size: stats.size,
      lastModified: stats.mtimeMs,
    };
  }
  return null;
});

ipcMain.handle("send-file", async (event, peerId, filePath) => {
  try {
    await p2pManager.sendFile(peerId, filePath);
    return true;
  } catch (error) {
    console.error("Failed to send file:", error);
    throw error;
  }
});

ipcMain.handle("refresh-peers", () => {
  p2pManager.refreshPeers();
});

// Handle app shutdown
app.on("before-quit", async () => {
  try {
    if (p2pManager) {
      await p2pManager.disconnect();
    }
    if (signalingServer) {
      await signalingServer.stop();
    }
    if (torDataDir) {
      await fs.remove(torDataDir);
    }
  } catch (error) {
    console.error("Error during shutdown:", error);
  }
});
