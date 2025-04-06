const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');
const { SocksProxyAgent } = require('socks-proxy-agent');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs-extra');

class SignalingServer {
  constructor() {
    this.app = express();
    this.server = http.createServer(this.app);
    this.io = new Server(this.server, {
      cors: {
        origin: '*',
        methods: ['GET', 'POST']
      }
    });
    
    this.peers = new Map();
    this.onionAddress = null;
    this.hiddenServiceDir = null;
  }

  async start(torDataDir) {
    // Create hidden service directory
    this.hiddenServiceDir = path.join(torDataDir, 'hidden_service');
    await fs.ensureDir(this.hiddenServiceDir);

    // Configure hidden service
    await fs.writeFile(
      path.join(torDataDir, 'torrc'),
      `
      HiddenServiceDir ${this.hiddenServiceDir}
      HiddenServicePort 80 127.0.0.1:3000
      `,
      { flag: 'a' } // Append to existing torrc
    );

    // Setup socket.io event handlers
    this.io.on('connection', (socket) => {
      console.log('Client connected:', socket.id);

      // Generate a unique peer ID
      const peerId = crypto.randomBytes(16).toString('hex');
      this.peers.set(peerId, socket);

      // Send the peer ID to the client
      socket.emit('peer-id', peerId);

      // Handle WebRTC signaling
      socket.on('signal', ({ targetPeerId, signal }) => {
        const targetPeer = this.peers.get(targetPeerId);
        if (targetPeer) {
          targetPeer.emit('signal', {
            fromPeerId: peerId,
            signal
          });
        }
      });

      // Handle peer discovery
      socket.on('discover', () => {
        const peerList = Array.from(this.peers.keys())
          .filter(id => id !== peerId);
        socket.emit('peers', peerList);
      });

      // Handle disconnection
      socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
        this.peers.delete(peerId);
        // Notify other peers about the disconnection
        this.io.emit('peer-disconnected', peerId);
      });
    });

    // Start the server
    return new Promise((resolve) => {
      this.server.listen(3000, '127.0.0.1', () => {
        console.log('Signaling server listening on port 3000');
        this.watchHiddenService();
        resolve();
      });
    });
  }

  async watchHiddenService() {
    // Watch for the hidden service hostname file
    const hostnameFile = path.join(this.hiddenServiceDir, 'hostname');
    let retries = 0;
    const maxRetries = 30;

    const checkHostname = async () => {
      try {
        if (await fs.pathExists(hostnameFile)) {
          this.onionAddress = (await fs.readFile(hostnameFile, 'utf8')).trim();
          console.log('Hidden service available at:', this.onionAddress);
          return;
        }
      } catch (error) {
        console.error('Error reading hostname file:', error);
      }

      if (++retries < maxRetries) {
        setTimeout(checkHostname, 1000);
      } else {
        console.error('Failed to get hidden service hostname');
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
          console.log('Signaling server stopped');
          resolve();
        });
      });
    });
  }
}

module.exports = SignalingServer; 