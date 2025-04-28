const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");
const { SocksProxyAgent } = require("socks-proxy-agent");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs-extra");
const { EventEmitter } = require("events");

class SignalingServer extends EventEmitter {
  constructor() {
    super();
    this.app = express();
    this.server = http.createServer(this.app);
    this.io = new Server(this.server, {
      cors: {
        origin: "*",
        methods: ["GET", "POST"],
      },
    });

    this.clients = new Map();
    this.onionAddress = null;
    this.hiddenServiceDir = null;
    this.activeTransfers = new Map();
  }

  async start(torDataDir) {
    // Create hidden service directory
    this.hiddenServiceDir = path.join(torDataDir, "hidden_service");
    await fs.ensureDir(this.hiddenServiceDir);

    // Setup socket.io event handlers
    this.io.on("connection", (socket) => {
      console.log("Client connected:", socket.id);

      // Generate a unique client ID
      const clientId = crypto.randomBytes(16).toString("hex");
      this.clients.set(clientId, socket);

      // Send the client ID to the client
      socket.emit("client-id", clientId);
      this.emit("client-ready", clientId);

      // Handle client discovery
      socket.on("discover", () => {
        const clientList = Array.from(this.clients.keys()).filter(
          (id) => id !== clientId,
        );
        console.log(`[SERVER] Sending client list to ${clientId}: ${clientList.length} clients found`);
        if (clientList.length > 0) {
          console.log(`[SERVER] Connected clients: ${clientList.join(', ')}`);
        } else {
          console.log('[SERVER] No other clients connected');
        }
        socket.emit("clients", clientList);
        this.emit("client-list", clientList);
      });

      // Handle file transfer requests
      socket.on("transfer-request", ({ targetClientId, metadata }) => {
        const targetClient = this.clients.get(targetClientId);
        if (targetClient) {
          targetClient.emit("transfer-request", {
            fromClientId: clientId,
            fileName: metadata.name,
            fileSize: metadata.size
          });
          this.emit("transfer-request", {
            fromClientId: clientId,
            fileName: metadata.name,
            fileSize: metadata.size
          });
        }
      });

      // Handle transfer responses
      socket.on("transfer-response", ({ targetClientId, accept }) => {
        const targetClient = this.clients.get(targetClientId);
        if (targetClient) {
          targetClient.emit("transfer-response", {
            fromClientId: clientId,
            accept
          });
          if (accept) {
            this.emit("transfer-accepted", clientId);
          } else {
            this.emit("transfer-rejected", clientId);
          }
        }
      });

      // Handle file chunks
      socket.on("file-chunk", ({ targetClientId, chunk }) => {
        const targetClient = this.clients.get(targetClientId);
        if (targetClient) {
          targetClient.emit("file-chunk", {
            fromClientId: clientId,
            chunk
          });
        }
      });

      // Handle disconnection
      socket.on("disconnect", () => {
        console.log("Client disconnected:", socket.id);
        this.clients.delete(clientId);
        // Notify other clients about the disconnection
        this.io.emit("client-disconnected", clientId);
        this.emit("client-disconnected", clientId);
      });
    });

    // Start the server
    return new Promise((resolve) => {
      this.server.listen(3000, "127.0.0.1", () => {
        console.log("Signaling server listening on port 3000");
        this.watchHiddenService();
        resolve();
      });
    });
  }

  async watchHiddenService() {
    // Watch for the hidden service hostname file
    const hostnameFile = path.join(this.hiddenServiceDir, "hostname");
    let retries = 0;
    const maxRetries = 30;

    const checkHostname = async () => {
      try {
        if (await fs.pathExists(hostnameFile)) {
          this.onionAddress = (await fs.readFile(hostnameFile, "utf8")).trim();
          console.log("Hidden service available at:", this.onionAddress);
          return;
        }
      } catch (error) {
        console.error("Error reading hostname file:", error);
      }

      if (++retries < maxRetries) {
        setTimeout(checkHostname, 1000);
      } else {
        console.error("Failed to get hidden service hostname");
      }
    };

    checkHostname();
  }

  getOnionAddress() {
    return this.onionAddress;
  }

  // Method to connect to a signaling server (for testing)
  async connect(url) {
    return new Promise((resolve, reject) => {
      const socket = this.io.connect(`http://${url}`);
      
      socket.on("connect", () => {
        console.log("Connected to signaling server");
        resolve(true);
      });
      
      socket.on("connect_error", (error) => {
        console.error("Failed to connect to signaling server:", error);
        reject(error);
      });
      
      // Set a timeout
      setTimeout(() => {
        reject(new Error("Connection timeout"));
      }, 10000);
    });
  }

  // Method to refresh the client list
  refreshClients() {
    this.io.emit("discover");
  }

  // Method to send a file to a client
  async sendFile(targetClientId, filePath) {
    const targetClient = this.clients.get(targetClientId);
    if (!targetClient) {
      throw new Error("Target client not found");
    }

    // Generate encryption key
    const key = crypto.randomBytes(32);
    this.activeTransfers.set(targetClientId, { key });

    // Send transfer request
    targetClient.emit("transfer-request", {
      fromClientId: "server",
      fileName: path.basename(filePath),
      fileSize: (await fs.stat(filePath)).size
    });

    // Wait for response
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Transfer request timed out"));
      }, 30000);

      const responseHandler = ({ fromClientId, accept }) => {
        if (fromClientId === targetClientId) {
          clearTimeout(timeout);
          targetClient.off("transfer-response", responseHandler);

          if (!accept) {
            this.activeTransfers.delete(targetClientId);
            reject(new Error("Transfer rejected by recipient"));
            return;
          }

          // Start sending file
          this.sendFileChunks(targetClientId, filePath, key)
            .then(() => {
              this.activeTransfers.delete(targetClientId);
              resolve();
            })
            .catch(error => {
              this.activeTransfers.delete(targetClientId);
              reject(error);
            });
        }
      };

      targetClient.on("transfer-response", responseHandler);
    });
  }

  // Helper method to send file chunks
  async sendFileChunks(targetClientId, filePath, key) {
    const targetClient = this.clients.get(targetClientId);
    if (!targetClient) {
      throw new Error("Target client not found");
    }

    const fileStream = fs.createReadStream(filePath, { highWaterMark: 16 * 1024 }); // 16KB chunks
    let bytesSent = 0;
    const fileStats = await fs.stat(filePath);

    for await (const chunk of fileStream) {
      const encryptedChunk = this.encryptChunk(chunk, key);
      targetClient.emit("file-chunk", {
        targetClientId,
        chunk: encryptedChunk
      });

      bytesSent += chunk.length;
      this.emit("transfer-progress", {
        targetClientId,
        progress: (bytesSent / fileStats.size) * 100,
        bytesSent,
        totalBytes: fileStats.size
      });
    }
  }

  // Method to respond to a transfer request
  respondToTransfer(fromClientId, accept) {
    const client = this.clients.get(fromClientId);
    if (!client) {
      throw new Error("Client not found");
    }

    client.emit("transfer-response", {
      targetClientId: fromClientId,
      accept
    });
  }

  // Encryption methods
  encryptChunk(chunk, key) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([
      cipher.update(chunk),
      cipher.final()
    ]);
    const authTag = cipher.getAuthTag();
    return Buffer.concat([iv, authTag, encrypted]);
  }

  decryptChunk(encryptedChunk, key) {
    const iv = encryptedChunk.slice(0, 16);
    const authTag = encryptedChunk.slice(16, 32);
    const encrypted = encryptedChunk.slice(32);
    
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    
    return Buffer.concat([
      decipher.update(encrypted),
      decipher.final()
    ]);
  }

  stop() {
    return new Promise((resolve) => {
      this.io.close(() => {
        this.server.close(() => {
          console.log("Signaling server stopped");
          resolve();
        });
      });
    });
  }
}

module.exports = SignalingServer;
