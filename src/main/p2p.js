const { EventEmitter } = require('events');
const { io } = require('socket.io-client');
const { SocksProxyAgent } = require('socks-proxy-agent');
const path = require('path');
const fs = require('fs-extra');
const { app } = require('electron');
const FileManager = require('./file');
const crypto = require('crypto');

class ClientManager extends EventEmitter {
  constructor() {
    super();
    this.socket = null;
    this.clientId = null;
    this.fileManager = new FileManager(path.join(app.getPath('downloads'), 'tor-share'));
    this.activeTransfers = new Map();
  }

  async connect(onionAddress) {
    // Connect to the signaling server through Tor
    const agent = new SocksProxyAgent('socks5h://127.0.0.1:9050');
    
    console.log("Connecting to signaling server.....")

    this.socket = io(`http://${onionAddress}`, {
      agent,
      transports: ['websocket'],
      upgrade: false
    });

    // Handle server events
    this.socket.on('connect', () => {
      console.log('Connected to signaling server!');
      this.socket.emit('discover');
    });

    this.socket.on('client-id', (id) => {
      console.log('Received client ID:', id);
      this.clientId = id;
      this.emit('ready', id);
    });

    this.socket.on('clients', (clients) => {
      console.log('Available clients:', clients);
      this.emit('clients', clients);
    });

    this.socket.on('transfer-request', async ({ fromClientId, metadata }) => {
      console.log('Received transfer request from:', fromClientId);
      this.emit('transfer-request', {
        fromClientId,
        fileName: metadata.name,
        fileSize: metadata.size
      });
    });

    this.socket.on('transfer-response', ({ fromClientId, accept }) => {
      console.log('Received transfer response from:', fromClientId);
      if (accept) {
        this.emit('transfer-accepted', fromClientId);
      } else {
        this.emit('transfer-rejected', fromClientId);
      }
    });

    this.socket.on('file-chunk', async ({ fromClientId, chunk }) => {
      try {
        const transfer = this.activeTransfers.get(fromClientId);
        if (!transfer) {
          throw new Error('No active transfer found');
        }

        const decryptedChunk = this.decryptChunk(chunk, transfer.key);
        const progress = await this.fileManager.writeChunk(fromClientId, decryptedChunk);
        
        this.emit('transfer-progress', {
          fromClientId,
          ...progress
        });
      } catch (error) {
        console.error('Error handling file chunk:', error);
        this.emit('error', {
          type: 'file-chunk-error',
          fromClientId,
          error: error.message
        });
      }
    });

    this.socket.on('client-disconnected', (clientId) => {
      console.log('Client disconnected:', clientId);
      this.cleanupTransfer(clientId);
      this.emit('client-disconnected', clientId);
    });

    // Set up periodic client discovery
    this.discoveryInterval = setInterval(() => {
      if (this.socket && this.socket.connected) {
        this.socket.emit('discover');
      }
    }, 10000);
  }

  async sendFile(targetClientId, filePath) {
    if (!this.socket || !this.socket.connected) {
      throw new Error('Not connected to server');
    }

    const fileStats = await fs.stat(filePath);
    const fileName = path.basename(filePath);
    const fileSize = fileStats.size;
    const chunkSize = 16 * 1024; // 16KB chunks

    // Generate encryption key
    const key = crypto.randomBytes(32);
    this.activeTransfers.set(targetClientId, { key });

    // Send transfer request
    this.socket.emit('transfer-request', {
      targetClientId,
      metadata: {
        name: fileName,
        size: fileSize
      }
    });

    // Wait for response
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Transfer request timed out'));
      }, 30000);

      const responseHandler = ({ fromClientId, accept }) => {
        if (fromClientId === targetClientId) {
          clearTimeout(timeout);
          this.socket.off('transfer-response', responseHandler);

          if (!accept) {
            this.cleanupTransfer(targetClientId);
            reject(new Error('Transfer rejected by recipient'));
            return;
          }

          // Start sending file
          this.sendFileChunks(targetClientId, filePath, chunkSize, key)
            .then(() => {
              this.cleanupTransfer(targetClientId);
              resolve();
            })
            .catch(error => {
              this.cleanupTransfer(targetClientId);
              reject(error);
            });
        }
      };

      this.socket.on('transfer-response', responseHandler);
    });
  }

  async sendFileChunks(targetClientId, filePath, chunkSize, key) {
    const fileStream = fs.createReadStream(filePath, { highWaterMark: chunkSize });
    let bytesSent = 0;
    const fileStats = await fs.stat(filePath);

    for await (const chunk of fileStream) {
      const encryptedChunk = this.encryptChunk(chunk, key);
      this.socket.emit('file-chunk', {
        targetClientId,
        chunk: encryptedChunk
      });

      bytesSent += chunk.length;
      this.emit('transfer-progress', {
        targetClientId,
        progress: (bytesSent / fileStats.size) * 100,
        bytesSent,
        totalBytes: fileStats.size
      });
    }
  }

  encryptChunk(chunk, key) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
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
    
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    
    return Buffer.concat([
      decipher.update(encrypted),
      decipher.final()
    ]);
  }

  respondToTransfer(fromClientId, accept) {
    this.socket.emit('transfer-response', {
      targetClientId: fromClientId,
      accept
    });
  }

  cleanupTransfer(clientId) {
    this.activeTransfers.delete(clientId);
    this.fileManager.cleanupIncompleteDownloads();
  }

  disconnect() {
    if (this.discoveryInterval) {
      clearInterval(this.discoveryInterval);
      this.discoveryInterval = null;
    }
    
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    
    // Cleanup all active transfers
    for (const clientId of this.activeTransfers.keys()) {
      this.cleanupTransfer(clientId);
    }
  }
}

module.exports = ClientManager; 