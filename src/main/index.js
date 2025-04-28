const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const os = require("os");
const { startTor, stopTor, getTorStatus } = require("./tor");
const SignalingClient = require("./signaling-client");
const ClientManager = require("./client-manager");
const fs = require("fs-extra");
const Store = require("electron-store").default;

// Initialize electron store for persistence
const store = new Store({
  defaults: {
    signalingServerUrl:
      "http://hh2pu2zm7szr3htz65z5wpnbqvt6km2havy5uruhlr4gpozsfiyh2myd.onion", // Working signaling server URL
  },
});

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require("electron-squirrel-startup")) {
  app.quit();
}

let mainWindow;
let torDataDir;
let signalingClient = null;
let clientManager = null;
let signalingServerUrl = store.get("signalingServerUrl");

// Add a tracking map for client IDs to prevent duplicates
const connectedClientIds = new Set();

// Add a map to track file transfers
const activeTransfers = new Map();

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "../preload/index.js"),
    },
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
    // Create temp directory for Tor data using platform-independent approach
    torDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "tor-"));

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
    mainWindow?.webContents.send(
      "error",
      `Initialization error: ${error.message}`,
    );
  }
};

// Function to verify Tor is actually running and available
const verifyTorAvailability = async (retries = 3, delay = 2000) => {
  const net = require("net");

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      await new Promise((resolve, reject) => {
        const socket = net.connect(
          {
            host: "127.0.0.1",
            port: 9055,
          },
          () => {
            console.log("Tor SOCKS proxy is available");
            socket.end();
            resolve();
          },
        );

        socket.on("error", (err) => {
          console.warn(
            `Tor SOCKS proxy not available (attempt ${attempt + 1}/${retries}): ${err.message}`,
          );
          socket.destroy();
          reject(err);
        });
      });

      // If we get here, connection was successful
      return true;
    } catch (error) {
      // If we've tried the max number of times, throw error
      if (attempt >= retries - 1) {
        throw new Error(
          `Could not connect to Tor SOCKS proxy after ${retries} attempts: ${error.message}`,
        );
      }

      // Otherwise wait and try again
      console.log(`Waiting ${delay}ms before retrying Tor connection...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
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
      console.log(`[MAIN] Client ready with ID: ${clientId}`);
      mainWindow?.webContents.send("client-ready", clientId);
    });

    signalingClient.on("client-list", (clients) => {
      console.log(`[MAIN] Received client list with ${clients.length} clients`);
      
      // Filter out our own ID if it's in the list
      const filteredClients = clients.filter(id => id !== signalingClient.clientId);
      console.log(`[MAIN] Filtered client list: ${filteredClients.join(', ') || 'none'}`);
      
      mainWindow?.webContents.send("client-list", filteredClients);
    });

    signalingClient.on("transfer-request", (data) => {
      console.log(`[MAIN] Received transfer request from ${data.fromClientId} for file ${data.fileName}`);
      
      // Forward to renderer for display
      mainWindow?.webContents.send("transfer-request", data);
      
      // Also handle it directly to show save dialog
      handleTransferRequest(data);
    });

    signalingClient.on("transfer-accepted", (clientId) => {
      console.log(`[MAIN] Transfer accepted by ${clientId}`);
      mainWindow?.webContents.send("transfer-accepted", clientId);
    });

    signalingClient.on("transfer-rejected", (clientId) => {
      console.log(`[MAIN] Transfer rejected by ${clientId}`);
      mainWindow?.webContents.send("transfer-rejected", clientId);
    });

    signalingClient.on("client-disconnected", (clientId) => {
      console.log(`[MAIN] Client disconnected: ${clientId}`);
      connectedClientIds.delete(clientId);
      mainWindow?.webContents.send("client-disconnected", clientId);
    });

    signalingClient.on("error", (error) => {
      console.error("[DEBUG] Signaling error:", error);
      mainWindow?.webContents.send("error", error.message);
    });

    // Add event handler for file chunks
    signalingClient.on("file-chunk", (data) => {
      console.log(`[MAIN] Received file chunk from ${data.fromClientId}, size: ${data.chunk ? data.chunk.length : 'unknown'} bytes`);
      
      // Process the chunk
      saveFileChunk(data.fromClientId, data.chunk);
    });

    // Connect to server
    await signalingClient.connect();
    mainWindow?.webContents.send("signaling-status", "connected");

    // Initialize client manager
    clientManager = new ClientManager(signalingClient);
    await clientManager.start();

    // Set up client manager event handlers
    clientManager.on("ready", (clientId) => {
      console.log(`[MAIN] Client manager ready with client ID: ${clientId}`);
      mainWindow?.webContents.send("client-ready", clientId);
    });

    clientManager.on("clients-updated", (clients) => {
      // Filter out duplicate clients by ID
      const uniqueClients = [];
      const seenIds = new Set();
      
      for (const client of clients) {
        if (!seenIds.has(client.id) && client.id !== signalingClient.clientId) {
          seenIds.add(client.id);
          uniqueClients.push(client);
        }
      }
      
      console.log(`[MAIN] Forwarding clients-updated event with ${uniqueClients.length} unique clients to renderer`);
      console.log('Client list details:', uniqueClients.map(client => client.id).join(', ') || 'No clients');
      
      mainWindow?.webContents.send("clients-updated", uniqueClients);
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
  console.log(
    `Refresh returning ${clients.length} current clients:`,
    clients.map((c) => c.id).join(", ") || "none",
  );
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
  console.log(
    `[IPC] Request to send file ${filePath} to client ${targetClientId}`,
  );

  try {
    if (!clientManager) {
      console.error("[IPC] Cannot send file: Client manager not initialized");
      throw new Error("Not connected to signaling server");
    }

    if (!targetClientId) {
      console.error("[IPC] Cannot send file: Target client ID is missing");
      throw new Error("Target client ID is required");
    }

    if (!filePath || typeof filePath !== "string") {
      console.error("[IPC] Cannot send file: Invalid file path", filePath);
      throw new Error("Valid file path is required");
    }

    console.log(`[IPC] Checking if file exists: ${filePath}`);
    try {
      await fs.access(filePath, fs.constants.R_OK);
    } catch (error) {
      console.error(`[IPC] File access error:`, error);
      throw new Error(`Cannot access file: ${error.message}`);
    }

    console.log(`[IPC] Starting file transfer to ${targetClientId}`);
    await clientManager.sendFile(targetClientId, filePath);
    console.log(`[IPC] File transfer initiated successfully`);
    return { success: true };
  } catch (error) {
    console.error(`[IPC] Error sending file:`, error);
    return { success: false, error: error.message };
  }
});

// Add a function to handle incoming transfer requests
async function handleTransferRequest(data) {
  const { fromClientId, fileName, fileSize } = data;
  console.log(`[MAIN] Handling transfer request from ${fromClientId} for ${fileName} (${fileSize} bytes)`);
  
  try {
    // Show save dialog to let user choose where to save the file
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Save File',
      defaultPath: path.join(app.getPath('downloads'), fileName),
      buttonLabel: 'Save',
      properties: ['createDirectory', 'showOverwriteConfirmation']
    });
    
    if (result.canceled) {
      console.log(`[MAIN] Save dialog canceled by user`);
      if (clientManager) {
        clientManager.rejectTransfer(fromClientId);
      }
      return;
    }
    
    const filePath = result.filePath;
    console.log(`[MAIN] User selected save location: ${filePath}`);
    
    // Create a transfer record
    const transfer = {
      filePath,
      fileName,
      bytesReceived: 0,
      fileSize,
      fromClientId
    };
    
    // Clean up any existing file at the path
    try {
      await fs.unlink(filePath);
    } catch (error) {
      // File doesn't exist, ignore
    }
    
    // Create an empty file
    await fs.writeFile(filePath, Buffer.alloc(0));
    
    // Store the transfer information
    activeTransfers.set(fromClientId, transfer);
    
    // Accept the transfer
    console.log(`[MAIN] Accepting file transfer from ${fromClientId}`);
    if (clientManager) {
      await clientManager.acceptTransfer(fromClientId, fileName);
      
      // Update UI with status
      mainWindow?.webContents.send("transfer-status-update", {
        clientId: fromClientId,
        status: 'receiving',
        fileName,
        filePath,
        fileSize
      });
    }
  } catch (error) {
    console.error(`[MAIN] Error handling transfer request:`, error);
    mainWindow?.webContents.send("error", `Failed to handle transfer: ${error.message}`);
    
    if (clientManager) {
      clientManager.rejectTransfer(fromClientId);
    }
  }
}

// Update the acceptTransfer IPC handler:
ipcMain.handle("accept-transfer", async (event, { fromClientId, fileName }) => {
  console.log(`[IPC] Accept transfer request received for ${fileName} from ${fromClientId}`);
  
  try {
    // Since we already handled this in handleTransferRequest, 
    // we just need to update the UI to avoid duplicated handling
    return { success: true };
  } catch (error) {
    console.error(`[IPC] Error accepting transfer:`, error);
    return { success: false, error: error.message };
  }
});

// Signaling server configuration handlers
ipcMain.handle("get-signaling-server", () => {
  return signalingServerUrl;
});

ipcMain.handle("set-signaling-server", async (event, url) => {
  try {
    if (!url || typeof url !== "string") {
      throw new Error("Invalid server URL");
    }

    // Validate URL format
    if (!url.endsWith(".onion")) {
      throw new Error("Server URL must be a .onion address");
    }

    // Add protocol if missing
    const fullUrl =
      url.startsWith("http://") || url.startsWith("https://")
        ? url
        : `http://${url}`;

    signalingServerUrl = fullUrl;
    store.set("signalingServerUrl", fullUrl);

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

// Add a function to save file chunks
async function saveFileChunk(fromClientId, chunk) {
  if (!activeTransfers.has(fromClientId)) {
    console.error(`[FILE] No active transfer for client ${fromClientId}`);
    return;
  }
  
  const transfer = activeTransfers.get(fromClientId);
  
  try {
    // Append the chunk to the file
    await fs.appendFile(transfer.filePath, chunk);
    
    // Update progress
    transfer.bytesReceived += chunk.length;
    const progress = (transfer.bytesReceived / transfer.fileSize) * 100;
    
    console.log(`[FILE] Chunk saved for ${fromClientId}, progress: ${progress.toFixed(2)}% (${transfer.bytesReceived}/${transfer.fileSize} bytes)`);
    
    // Emit progress event to renderer
    mainWindow?.webContents.send("transfer-progress", {
      targetClientId: fromClientId,
      progress,
      bytesSent: transfer.bytesReceived,
      totalBytes: transfer.fileSize
    });
    
    // Check if transfer is complete
    if (transfer.bytesReceived >= transfer.fileSize) {
      console.log(`[FILE] Transfer complete for ${fromClientId}, file saved to ${transfer.filePath}`);
      
      // Emit completion event to renderer
      mainWindow?.webContents.send("transfer-complete", {
        targetClientId: fromClientId
      });
      
      // Clean up transfer
      activeTransfers.delete(fromClientId);
    }
  } catch (error) {
    console.error(`[FILE] Error saving chunk:`, error);
    
    // Emit error event to renderer
    mainWindow?.webContents.send("transfer-error", {
      clientId: fromClientId,
      error: error.message
    });
    
    // Clean up transfer
    activeTransfers.delete(fromClientId);
  }
}

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
