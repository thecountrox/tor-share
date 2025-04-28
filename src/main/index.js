const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const { startTor, stopTor, getTorStatus } = require("./tor");
const SignalingClient = require("./signaling-client");
const ClientManager = require("./client-manager");
const fs = require("fs-extra");
const Store = require('electron-store').default;

// Initialize electron store for persistence
const store = new Store({
  defaults: {
    signalingServerUrl: 'http://hh2pu2zm7szr3htz65z5wpnbqvt6km2havy5uruhlr4gpozsfiyh2myd.onion'  // Working signaling server URL
  }
});

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require("electron-squirrel-startup")) {
  app.quit();
}

let mainWindow;
let torDataDir;
let signalingClient = null;
let clientManager = null;
let signalingServerUrl = store.get('signalingServerUrl');

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "../preload/index.js")
    }
  });

  // In development, load from localhost
  if (process.env.NODE_ENV === "development") {
    mainWindow.loadURL("http://localhost:3000");
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
    mainWindow.webContents.openDevTools(); // Temporarily enable DevTools for debugging
  }
};

const initializeApp = async () => {
  try {
    // Create temp directory for Tor data
    torDataDir = await fs.mkdtemp("/tmp/tor-");

    // Start Tor
    await startTor(torDataDir);
    mainWindow?.webContents.send("tor-status", "started");

    // Verify Tor is available
    await verifyTorAvailability();

    // Only try to connect to signaling server if we have a URL
    if (signalingServerUrl) {
      mainWindow?.webContents.send("signaling-server-url", signalingServerUrl);
      await connectToSignalingServer(signalingServerUrl);
    }

  } catch (error) {
    console.error("Failed to initialize app:", error);
    mainWindow?.webContents.send("tor-status", "error");
    mainWindow?.webContents.send("error", `Initialization error: ${error.message}`);
  }
};

// Function to verify Tor is actually running and available
const verifyTorAvailability = async (retries = 3, delay = 2000) => {
  const net = require('net');
  
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      await new Promise((resolve, reject) => {
        const socket = net.connect({
          host: '127.0.0.1',
          port: 9050
        }, () => {
          console.log('Tor SOCKS proxy is available');
          socket.end();
          resolve();
        });
        
        socket.on('error', (err) => {
          console.warn(`Tor SOCKS proxy not available (attempt ${attempt + 1}/${retries}): ${err.message}`);
          socket.destroy();
          reject(err);
        });
      });
      
      // If we get here, connection was successful
      return true;
    } catch (error) {
      // If we've tried the max number of times, throw error
      if (attempt >= retries - 1) {
        throw new Error(`Could not connect to Tor SOCKS proxy after ${retries} attempts: ${error.message}`);
      }
      
      // Otherwise wait and try again
      console.log(`Waiting ${delay}ms before retrying Tor connection...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
};

const connectToSignalingServer = async (url) => {
  try {
    // Disconnect from current server if connected
    if (signalingClient) {
      signalingClient.disconnect();
    }

    // Create new signaling client with development mode detection
    const isDev = process.env.NODE_ENV === "development";
    signalingClient = new SignalingClient(url, { bypassTor: isDev });

    // Set up event handlers
    signalingClient.on("client-ready", (clientId) => {
      mainWindow?.webContents.send("client-ready", clientId);
    });

    signalingClient.on("client-list", (clients) => {
      mainWindow?.webContents.send("client-list", clients);
    });

    signalingClient.on("transfer-request", (data) => {
      mainWindow?.webContents.send("transfer-request", data);
    });

    signalingClient.on("transfer-accepted", (clientId) => {
      mainWindow?.webContents.send("transfer-accepted", clientId);
    });

    signalingClient.on("transfer-rejected", (clientId) => {
      mainWindow?.webContents.send("transfer-rejected", clientId);
    });

    signalingClient.on("client-disconnected", (clientId) => {
      mainWindow?.webContents.send("client-disconnected", clientId);
    });

    signalingClient.on("error", (error) => {
      console.error("[DEBUG] Signaling error:", error);
      mainWindow?.webContents.send("error", error.message);
    });

    // Connect to server
    await signalingClient.connect();
    mainWindow?.webContents.send("signaling-status", "connected");

    // Initialize client manager
    clientManager = new ClientManager(signalingClient);
    await clientManager.start();

    // Set up client manager event handlers
    clientManager.on("ready", (clientId) => {
      mainWindow?.webContents.send("client-ready", clientId);
    });

    clientManager.on("clients-updated", (clients) => {
      console.log(`Main process: Forwarding clients-updated event with ${clients.length} clients to renderer`);
      console.log('Client list details:', clients.map(client => client.id).join(', ') || 'No clients');
      mainWindow?.webContents.send("clients-updated", clients);
    });

    clientManager.on("client-disconnected", (clientId) => {
      mainWindow?.webContents.send("client-disconnected", clientId);
    });

    clientManager.on("transfer-request", (data) => {
      mainWindow?.webContents.send("transfer-request", data);
    });

    clientManager.on("transfer-accepted", (clientId) => {
      mainWindow?.webContents.send("transfer-accepted", clientId);
    });

    clientManager.on("transfer-rejected", (clientId) => {
      mainWindow?.webContents.send("transfer-rejected", clientId);
    });

    clientManager.on("transfer-progress", (data) => {
      mainWindow?.webContents.send("transfer-progress", data);
    });

    clientManager.on("transfer-complete", (data) => {
      mainWindow?.webContents.send("transfer-complete", data);
    });

    clientManager.on("transfer-error", (data) => {
      mainWindow?.webContents.send("transfer-error", data);
    });

    clientManager.on("disconnected", () => {
      mainWindow?.webContents.send("signaling-status", "disconnected");
    });

    return true;
  } catch (error) {
    console.error("Failed to connect to signaling server:", error);
    mainWindow?.webContents.send("signaling-status", "error");
    mainWindow?.webContents.send("error", error.message);
    return false;
  }
};

app.whenReady().then(async () => {
  createWindow();
  await initializeApp();

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

ipcMain.handle("refresh-clients", async () => {
  if (!signalingClient) {
    console.error("Cannot refresh clients: Signaling client not initialized");
    throw new Error("Signaling client not connected");
  }
  
  console.log("Manually refreshing client list");
  
  // Trigger discovery immediately
  signalingClient.discover();
  
  // Return the current list (though the updated list will come via the clients-updated event)
  const clients = clientManager?.getConnectedClients() || [];
  console.log(`Refresh returning ${clients.length} current clients:`, clients.map(c => c.id).join(', ') || 'none');
  return clients;
});

// Add back the missing IPC handlers
ipcMain.handle("get-client-id", () => {
  return clientManager?.clientId;
});

ipcMain.handle("get-connected-clients", () => {
  const clients = clientManager?.getConnectedClients() || [];
  console.log(`IPC: Returning ${clients.length} connected clients`);
  return clients;
});

ipcMain.handle("send-file", async (event, { targetClientId, filePath }) => {
  try {
    if (!clientManager) {
      throw new Error("Not connected to signaling server");
    }
    await clientManager.sendFile(targetClientId, filePath);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle("accept-transfer", async (event, { fromClientId, fileName }) => {
  try {
    if (!clientManager) {
      throw new Error("Not connected to signaling server");
    }
    await clientManager.acceptTransfer(fromClientId, fileName);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle("reject-transfer", (event, { fromClientId }) => {
  try {
    if (!clientManager) {
      throw new Error("Not connected to signaling server");
    }
    clientManager.rejectTransfer(fromClientId);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Signaling server configuration handlers
ipcMain.handle("get-signaling-server", () => {
  return signalingServerUrl;
});

ipcMain.handle("set-signaling-server", async (event, url) => {
  try {
    if (!url || typeof url !== 'string') {
      throw new Error("Invalid server URL");
    }
    
    // Validate URL format
    if (!url.endsWith('.onion')) {
      throw new Error("Server URL must be a .onion address");
    }

    // Add protocol if missing
    const fullUrl = url.startsWith('http://') || url.startsWith('https://') ? url : `http://${url}`;
    
    signalingServerUrl = fullUrl;
    store.set('signalingServerUrl', fullUrl);
    
    // Try to connect and return the result
    const success = await connectToSignalingServer(fullUrl);
    if (!success) {
      throw new Error("Failed to connect to signaling server");
    }
    return true;
  } catch (error) {
    console.error("Failed to set signaling server:", error);
    mainWindow?.webContents.send("error", error.message);
    return false;
  }
});

// Handle app shutdown
app.on("before-quit", () => {
  if (signalingClient) {
    signalingClient.disconnect();
  }
  stopTor();
});
