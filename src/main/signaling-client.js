const { io } = require("socket.io-client");
const { EventEmitter } = require("events");
const { SocksProxyAgent } = require("socks-proxy-agent");

class SignalingClient extends EventEmitter {
  constructor(serverUrl, options = {}) {
    super();

    // Validate server URL
    if (!serverUrl) {
      throw new Error("Server URL is required");
    }

    // Ensure URL has the correct protocol prefix
    if (!serverUrl.startsWith("http://") && !serverUrl.startsWith("https://")) {
      this.serverUrl = `http://${serverUrl}`;
    } else {
      this.serverUrl = serverUrl;
    }

    this.socket = null;
    this.clientId = null;
    this.options = {
      bypassTor: false,
      ...options,
    };
    console.log(
      `SignalingClient created with serverUrl: ${this.serverUrl}, bypassTor: ${this.options.bypassTor}`,
    );
  }

  async connect(retries = 3, retryDelay = 2000) {
    let lastError = null;

    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        return await this._connectAttempt();
      } catch (error) {
        lastError = error;
        console.error(
          `Connection attempt ${attempt + 1}/${retries} failed:`,
          error,
        );

        if (error.message && error.message.includes("ECONNREFUSED")) {
          console.error(
            "Tor may not be running or accessible. Check Tor status before retrying.",
          );
        }

        // If we've tried the max number of times, throw error
        if (attempt >= retries - 1) {
          throw new Error(
            `Failed to connect to signaling server after ${retries} attempts: ${lastError.message}`,
          );
        }

        // Otherwise wait and try again
        console.log(`Waiting ${retryDelay}ms before retrying connection...`);
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
      }
    }
  }

  async _connectAttempt() {
    return new Promise((resolve, reject) => {
      try {
        const socketOptions = {
          transports: ["websocket", "polling"],
          reconnection: true,
          reconnectionAttempts: 5,
          reconnectionDelay: 1000,
          forceNew: true, // Always create a new connection
          timeout: 10000, // 10 second timeout
        };

        // Only use the SOCKS proxy agent if not bypassing Tor
        if (!this.options.bypassTor) {
          console.log("Using Tor SOCKS proxy for connection");
          const agent = new SocksProxyAgent("socks5h://127.0.0.1:9055");
          socketOptions.agent = agent;
        } else {
          console.log("Bypassing Tor for direct connection (development mode)");
        }

        // Create socket connection with configured options
        this.socket = io(this.serverUrl, socketOptions);

        // Set up event handlers
        this.socket.on("connect", () => {
          console.log(
            "[CLIENT] Connected to signaling server at",
            this.serverUrl,
          );
          this.discover();
          resolve();
        });

        this.socket.on("client-id", (clientId) => {
          this.clientId = clientId;
          console.log(`[CLIENT] Received client ID: ${clientId}`);
          this.emit("client-ready", clientId);
        });

        this.socket.on("clients", (clientList) => {
          console.log(
            `[CLIENT ${this.clientId}] Received client list from server with ${clientList.length} clients`,
          );
          if (clientList.length > 0) {
            console.log(
              `[CLIENT ${this.clientId}] Available clients: ${clientList.join(", ")}`,
            );
          } else {
            console.log(`[CLIENT ${this.clientId}] No other clients available`);
          }
          this.emit("clients", clientList);
        });

        this.socket.on("transfer-request", (data) => {
          console.log(`[CLIENT ${this.clientId}] Received transfer request:`, data);
          this.emit("transfer-request", data);
        });

        this.socket.on("transfer-response", (data) => {
          console.log(`[CLIENT ${this.clientId}] Received transfer response:`, data);
          // First emit the raw event for any listeners
          this.emit("transfer-response", data);
          
          // Then also emit the result-specific events for backward compatibility
          if (data.accept) {
            console.log(`[CLIENT ${this.clientId}] Transfer was accepted by ${data.fromClientId}`);
            this.emit("transfer-accepted", data.fromClientId);
          } else {
            console.log(`[CLIENT ${this.clientId}] Transfer was rejected by ${data.fromClientId}`);
            this.emit("transfer-rejected", data.fromClientId);
          }
        });

        this.socket.on("file-chunk", (data) => {
          console.log(`[CLIENT ${this.clientId}] Received file chunk from ${data.fromClientId}, size: ${data.chunk ? data.chunk.length : 'unknown'} bytes`);
          this.emit("file-chunk", data);
        });

        this.socket.on("client-disconnected", (clientId) => {
          console.log(`[CLIENT ${this.clientId}] Client disconnected: ${clientId}`);
          this.emit("client-disconnected", clientId);
        });

        this.socket.on("connect_error", (error) => {
          console.error("Signaling server connection error:", error);
          this.emit("error", error);
          reject(error);
        });

        // Set a connection timeout
        const timeoutId = setTimeout(() => {
          // Check if socket still exists and isn't connected
          if (this.socket && !this.socket.connected) {
            const timeoutError = new Error("Connection timeout");
            this.emit("error", timeoutError);
            reject(timeoutError);
          } else if (!this.socket) {
            // Socket was destroyed before timeout
            const destroyedError = new Error(
              "Socket was destroyed before connection was established",
            );
            this.emit("error", destroyedError);
            reject(destroyedError);
          }
        }, 10000);

        // Make sure we clear the timeout if socket gets disconnected
        this.socket.on("disconnect", () => {
          clearTimeout(timeoutId);
          console.log("Disconnected from signaling server");
          this.emit("disconnected");
        });
      } catch (error) {
        console.error("Error initializing socket connection:", error);
        reject(new Error(`Failed to initialize socket: ${error.message}`));
      }
    });
  }

  discover() {
    if (this.socket) {
      console.log(
        `[CLIENT ${this.clientId}] Requesting client list from signaling server`,
      );
      this.socket.emit("discover");
    } else {
      console.warn(`[CLIENT] Cannot discover: Socket not connected`);
    }
  }

  // Add method to periodically discover clients
  startPeriodicDiscovery(interval = 5000) {
    // Clear any existing interval
    if (this._discoveryInterval) {
      clearInterval(this._discoveryInterval);
    }

    console.log(
      `[CLIENT ${this.clientId || "unknown"}] Starting periodic discovery every ${interval}ms`,
    );
    this._discoveryInterval = setInterval(() => {
      this.discover();
    }, interval);

    // First discovery immediately
    this.discover();
  }

  stopPeriodicDiscovery() {
    if (this._discoveryInterval) {
      console.log("Stopping periodic discovery");
      clearInterval(this._discoveryInterval);
      this._discoveryInterval = null;
    }
  }

  sendTransferRequest(targetClientId, metadata) {
    if (this.socket) {
      console.log(
        `[CLIENT ${this.clientId}] Sending transfer request to ${targetClientId}:`,
        metadata,
      );
      this.socket.emit("transfer-request", { targetClientId, metadata });
    } else {
      console.error(
        `[CLIENT ${this.clientId}] Cannot send transfer request: Socket not connected`,
      );
    }
  }

  sendTransferResponse(targetClientId, accept) {
    if (this.socket) {
      console.log(`[CLIENT ${this.clientId}] Sending transfer response to ${targetClientId}: ${accept ? 'ACCEPT' : 'REJECT'}`);
      const response = { targetClientId, accept };
      console.log(`[CLIENT ${this.clientId}] Response payload:`, response);
      this.socket.emit('transfer-response', response);
    } else {
      console.error(`[CLIENT ${this.clientId}] Cannot send transfer response: Socket not connected`);
    }
  }

  sendFileChunk(targetClientId, chunk) {
    if (this.socket) {
      console.log(
        `[CLIENT ${this.clientId}] Sending file chunk to ${targetClientId}: ${chunk.length} bytes`,
      );
      this.socket.emit("file-chunk", { targetClientId, chunk });
    } else {
      console.error(
        `[CLIENT ${this.clientId}] Cannot send file chunk: Socket not connected`,
      );
    }
  }

  disconnect() {
    try {
      if (this.socket) {
        // Remove all listeners to prevent any callback errors
        this.socket.removeAllListeners();

        // Only try to disconnect if the socket exists and isn't already disconnected
        if (this.socket.connected) {
          this.socket.disconnect();
        }

        this.socket = null;
      }
    } catch (error) {
      console.error("Error during disconnection:", error);
    }
  }
}

module.exports = SignalingClient;
