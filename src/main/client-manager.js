const { EventEmitter } = require("events");
const crypto = require("crypto");
const fs = require("fs-extra");
const path = require("path");

class ClientManager extends EventEmitter {
  constructor(signalingClient) {
    super();
    this.signalingClient = signalingClient;
    this.clientId = null;
    this.connectedClients = new Map();
    this.activeTransfers = new Map();
  }

  async start() {
    // Set up event handlers
    this.signalingClient.on("client-id", (clientId) => {
      this.clientId = clientId;
      this.emit("ready", clientId);
    });

    this.signalingClient.on("clients", (clients) => {
      console.log(`Received client list from server with ${clients ? clients.length : 0} clients`);
      this.connectedClients.clear();
      console.log(`[CLIENT-MANAGER] Processing client list with ${clients ? clients.length : 0} clients`);
      for (const clientId of clients) {
        console.log(`Adding client ${clientId} to connected clients list`);
        this.connectedClients.set(clientId, { id: clientId });
      }
      const clientArray = Array.from(this.connectedClients.values());
      console.log(`Emitting clients-updated event with ${clientArray.length} clients`);
      this.emit("clients-updated", clientArray);
    });

    this.signalingClient.on("client-disconnected", (clientId) => {
      this.connectedClients.delete(clientId);
      this.emit("client-disconnected", clientId);
      this.emit("clients-updated", Array.from(this.connectedClients.values()));
    });

    this.signalingClient.on("transfer-request", async (data) => {
      this.emit("transfer-request", data);
    });

    this.signalingClient.on("transfer-response", (data) => {
      if (data.accept) {
        this.emit("transfer-accepted", data.fromClientId);
      } else {
        this.emit("transfer-rejected", data.fromClientId);
      }
    });

    this.signalingClient.on("file-chunk", (data) => {
      this.emit("file-chunk", data);
    });

    this.signalingClient.on("disconnected", () => {
      this.emit("disconnected");
    });

    // Start periodic discovery (every 5 seconds)
    this.signalingClient.startPeriodicDiscovery(5000);
  }

  getConnectedClients() {
    return Array.from(this.connectedClients.values());
  }

  async sendFile(targetClientId, filePath) {
    if (!this.connectedClients.has(targetClientId)) {
      throw new Error("Target client not connected");
    }

    const stats = await fs.stat(filePath);
    const metadata = {
      name: path.basename(filePath),
      size: stats.size,
      lastModified: stats.mtimeMs
    };

    // Send transfer request
    this.signalingClient.sendTransferRequest(targetClientId, metadata);

    // Wait for response
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Transfer request timed out"));
      }, 30000);

      const responseHandler = (data) => {
        if (data.fromClientId === targetClientId) {
          clearTimeout(timeout);
          this.signalingClient.removeListener("transfer-response", responseHandler);

          if (!data.accept) {
            reject(new Error("Transfer rejected by recipient"));
            return;
          }

          // Start sending file
          this.sendFileChunks(targetClientId, filePath)
            .then(() => resolve())
            .catch(error => reject(error));
        }
      };

      this.signalingClient.on("transfer-response", responseHandler);
    });
  }

  async sendFileChunks(targetClientId, filePath) {
    const fileStream = fs.createReadStream(filePath, { highWaterMark: 16 * 1024 }); // 16KB chunks
    let bytesSent = 0;
    const fileStats = await fs.stat(filePath);

    for await (const chunk of fileStream) {
      this.signalingClient.sendFileChunk(targetClientId, chunk);
      bytesSent += chunk.length;
      this.emit("transfer-progress", {
        targetClientId,
        progress: (bytesSent / fileStats.size) * 100,
        bytesSent,
        totalBytes: fileStats.size
      });
    }

    this.emit("transfer-complete", { targetClientId });
  }

  acceptTransfer(fromClientId, fileName) {
    this.signalingClient.sendTransferResponse(fromClientId, true);
  }

  rejectTransfer(fromClientId) {
    this.signalingClient.sendTransferResponse(fromClientId, false);
  }
}

module.exports = ClientManager; 