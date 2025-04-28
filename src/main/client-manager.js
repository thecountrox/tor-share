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
    console.log(`[CLIENT-MANAGER] Attempting to send file ${filePath} to client ${targetClientId}`);
    
    if (!this.connectedClients.has(targetClientId)) {
      console.error(`[CLIENT-MANAGER] Client ${targetClientId} not connected, cannot send file`);
      throw new Error("Target client not connected");
    }

    const stats = await fs.stat(filePath);
    const metadata = {
      name: path.basename(filePath),
      size: stats.size,
      lastModified: stats.mtimeMs
    };

    console.log(`[CLIENT-MANAGER] Sending transfer request for file ${metadata.name} (${metadata.size} bytes) to ${targetClientId}`);
    
    // Send transfer request
    this.signalingClient.sendTransferRequest(targetClientId, metadata);

    // Wait for response
    return new Promise((resolve, reject) => {
      console.log(`[CLIENT-MANAGER] Waiting for response from ${targetClientId}`);
      
      // Track if we've received a response
      let responseReceived = false;
      
      // Create explicit one-time handler for transfer-response event
      const responseHandler = (data) => {
        console.log(`[CLIENT-MANAGER] Received transfer response from ${data.fromClientId}:`, data);
        
        if (data.fromClientId === targetClientId) {
          responseReceived = true;
          clearTimeout(timeout);
          this.signalingClient.removeListener("transfer-response", responseHandler);

          if (!data.accept) {
            console.error(`[CLIENT-MANAGER] Transfer rejected by recipient ${targetClientId}`);
            reject(new Error("Transfer rejected by recipient"));
            return;
          }

          // Start sending file
          console.log(`[CLIENT-MANAGER] Transfer accepted by ${targetClientId}, starting file transfer`);
          this.sendFileChunks(targetClientId, filePath)
            .then(() => {
              console.log(`[CLIENT-MANAGER] File transfer to ${targetClientId} completed successfully`);
              resolve();
            })
            .catch(error => {
              console.error(`[CLIENT-MANAGER] Error during file transfer to ${targetClientId}:`, error);
              reject(error);
            });
        } else {
          console.log(`[CLIENT-MANAGER] Received response from ${data.fromClientId} but waiting for ${targetClientId}`);
        }
      };

      // Create a separate listener for all transfer responses to debug
      const debugAllResponsesHandler = (data) => {
        console.log(`[CLIENT-MANAGER-DEBUG] Transfer response detected:`, data);
      };
      
      this.signalingClient.on("transfer-response", debugAllResponsesHandler);
      this.signalingClient.on("transfer-response", responseHandler);
      
      // Set up timeout
      const timeout = setTimeout(() => {
        this.signalingClient.removeListener("transfer-response", responseHandler);
        this.signalingClient.removeListener("transfer-response", debugAllResponsesHandler);
        
        console.error(`[CLIENT-MANAGER] Transfer request to ${targetClientId} timed out. Response received: ${responseReceived}`);
        
        // Try to directly check if client is still connected
        if (this.connectedClients.has(targetClientId)) {
          console.log(`[CLIENT-MANAGER] Client ${targetClientId} is still in the connected clients list`);
        } else {
          console.log(`[CLIENT-MANAGER] Client ${targetClientId} is no longer in the connected clients list`);
        }
        
        reject(new Error("Transfer request timed out"));
      }, 30000);
    });
  }

  async sendFileChunks(targetClientId, filePath) {
    console.log(`[CLIENT-MANAGER] Starting to send file chunks for ${filePath} to ${targetClientId}`);
    
    const fileStream = fs.createReadStream(filePath, { highWaterMark: 16 * 1024 }); // 16KB chunks
    let bytesSent = 0;
    let chunkCount = 0;
    const fileStats = await fs.stat(filePath);

    try {
      for await (const chunk of fileStream) {
        console.log(`[CLIENT-MANAGER] Sending chunk ${++chunkCount} (${chunk.length} bytes) to ${targetClientId}`);
        this.signalingClient.sendFileChunk(targetClientId, chunk);
        bytesSent += chunk.length;
        
        const progress = (bytesSent / fileStats.size) * 100;
        console.log(`[CLIENT-MANAGER] Transfer progress: ${progress.toFixed(2)}% (${bytesSent}/${fileStats.size} bytes)`);
        
        this.emit("transfer-progress", {
          targetClientId,
          progress,
          bytesSent,
          totalBytes: fileStats.size
        });
      }

      console.log(`[CLIENT-MANAGER] All chunks sent to ${targetClientId}, total: ${bytesSent} bytes in ${chunkCount} chunks`);
      this.emit("transfer-complete", { targetClientId });
    } catch (error) {
      console.error(`[CLIENT-MANAGER] Error sending file chunks to ${targetClientId}:`, error);
      throw error;
    }
  }

  acceptTransfer(fromClientId, fileName) {
    console.log(`[CLIENT-MANAGER] Accepting transfer from ${fromClientId} for file ${fileName}`);
    this.signalingClient.sendTransferResponse(fromClientId, true);
  }

  rejectTransfer(fromClientId) {
    console.log(`[CLIENT-MANAGER] Rejecting transfer from ${fromClientId}`);
    this.signalingClient.sendTransferResponse(fromClientId, false);
  }
}

module.exports = ClientManager; 