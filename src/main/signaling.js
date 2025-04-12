const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");
const { SocksProxyAgent } = require("socks-proxy-agent");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs-extra");

class SignalingServer {
  constructor() {
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
  }

  async start(torDataDir) {
    // Create hidden service directory
    this.hiddenServiceDir = path.join(torDataDir, "hidden_service");
    await fs.ensureDir(this.hiddenServiceDir);

    // Configure hidden service
    await fs.writeFile(
      path.join(torDataDir, "torrc"),
      `
      HiddenServiceDir ${this.hiddenServiceDir}
      HiddenServicePort 80 127.0.0.1:3000
      `,
      { flag: "a" },
    );

    // Setup socket.io event handlers
    this.io.on("connection", (socket) => {
      console.log("Client connected:", socket.id);

      // Generate a unique client ID
      const clientId = crypto.randomBytes(16).toString("hex");
      this.clients.set(clientId, socket);

      // Send the client ID
      socket.emit("client-id", clientId);

      // Handle file transfer requests
      socket.on("transfer-request", ({ targetClientId, metadata }) => {
        const targetClient = this.clients.get(targetClientId);
        if (targetClient) {
          targetClient.emit("transfer-request", {
            fromClientId: clientId,
            metadata
          });
        }
      });

      // Handle transfer response
      socket.on("transfer-response", ({ targetClientId, accept }) => {
        const targetClient = this.clients.get(targetClientId);
        if (targetClient) {
          targetClient.emit("transfer-response", {
            fromClientId: clientId,
            accept
          });
        }
      });

      // Handle encrypted file chunks
      socket.on("file-chunk", ({ targetClientId, chunk }) => {
        const targetClient = this.clients.get(targetClientId);
        if (targetClient) {
          targetClient.emit("file-chunk", {
            fromClientId: clientId,
            chunk
          });
        }
      });

      // Handle client discovery
      socket.on("discover", () => {
        const clientList = Array.from(this.clients.keys()).filter(
          (id) => id !== clientId
        );
        socket.emit("clients", clientList);
      });

      // Handle disconnection
      socket.on("disconnect", () => {
        console.log("Client disconnected:", socket.id);
        this.clients.delete(clientId);
        this.io.emit("client-disconnected", clientId);
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
