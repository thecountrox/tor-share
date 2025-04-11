const { EventEmitter } = require("events");
const wrtc = require("wrtc");
const { io } = require("socket.io-client");
const { SocksProxyAgent } = require("socks-proxy-agent");
const path = require("path");
const fs = require("fs-extra");
const { app } = require("electron");
const FileManager = require("./file");

class P2PManager extends EventEmitter {
  constructor() {
    super();
    console.log("[DEBUG] Initializing P2PManager");
    this.peerConnections = new Map();
    this.dataChannels = new Map();
    this.socket = null;
    this.peerId = null;

    // Initialize FileManager with absolute path
    const downloadDir = path.join(app.getPath("downloads"), "tor-share");
    console.log("[DEBUG] Creating FileManager with directory:", downloadDir);
    this.fileManager = new FileManager(downloadDir);

    // Bind methods to ensure correct 'this' context
    this.handleMessage = this.handleMessage.bind(this);
    this.setupDataChannel = this.setupDataChannel.bind(this);

    this.configuration = {
      iceServers: [
        {
          urls: "stun:stun.l.google.com:19302",
        },
      ],
    };

    this.pendingAcks = new Map(); // Track pending acknowledgments
    this.windowSize = 5; // Number of chunks to send before waiting for acks
    this.chunkSize = 16 * 1024; // 16KB chunks
  }

  async connect(onionAddress) {
    // Connect to the signaling server through Tor
    const agent = new SocksProxyAgent("socks5h://127.0.0.1:9050");

    console.log("Connecting to signaling server.....");

    this.socket = io(`http://${onionAddress}`, {
      agent,
      transports: ["websocket"],
      upgrade: false,
    });

    // Handle signaling server events
    this.socket.on("connect", () => {
      console.log("Connected to signaling server!");
      this.socket.emit("discover");
    });

    this.socket.on("peer-id", (id) => {
      console.log("Received peer ID:", id);
      this.peerId = id;
      this.emit("ready", id);
    });

    this.socket.on("peers", (peers) => {
      console.log("Available peers:", peers);
      this.emit("peers", peers);
    });

    this.socket.on("signal", async ({ fromPeerId, signal }) => {
      console.log("Received signal from peer:", fromPeerId);
      await this.handleSignal(fromPeerId, signal);
    });

    this.socket.on("peer-disconnected", (peerId) => {
      console.log("Peer disconnected:", peerId);
      this.cleanupPeer(peerId);
      this.emit("peer-disconnected", peerId);
    });

    // Set up periodic peer discovery
    this.discoveryInterval = setInterval(() => {
      if (this.socket && this.socket.connected) {
        this.socket.emit("discover");
      }
    }, 10000); // Refresh every 10 seconds
  }

  async createPeerConnection(peerId, initiator = false) {
    console.log(
      `Creating peer connection with ${peerId} (initiator: ${initiator})`,
    );

    const pc = new wrtc.RTCPeerConnection(this.configuration);
    this.peerConnections.set(peerId, pc);

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.socket.emit("signal", {
          targetPeerId: peerId,
          signal: {
            type: "candidate",
            candidate: event.candidate,
          },
        });
      }
    };

    // Handle data channel
    if (initiator) {
      const dataChannel = pc.createDataChannel("fileTransfer");
      this.setupDataChannel(peerId, dataChannel);
    } else {
      pc.ondatachannel = (event) => {
        this.setupDataChannel(peerId, event.channel);
      };
    }

    return pc;
  }

  async handleSignal(peerId, signal) {
    let pc = this.peerConnections.get(peerId);

    if (!pc) {
      pc = await this.createPeerConnection(peerId, false);
    }

    try {
      if (signal.type === "offer") {
        await pc.setRemoteDescription(new wrtc.RTCSessionDescription(signal));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        this.socket.emit("signal", {
          targetPeerId: peerId,
          signal: answer,
        });
      } else if (signal.type === "answer") {
        await pc.setRemoteDescription(new wrtc.RTCSessionDescription(signal));
      } else if (signal.type === "candidate") {
        await pc.addIceCandidate(new wrtc.RTCIceCandidate(signal.candidate));
      }
    } catch (error) {
      console.error("Error handling signal:", error);
    }
  }

  setupDataChannel(peerId, dataChannel) {
    console.log("[DEBUG] Setting up data channel for peer:", peerId);
    dataChannel.binaryType = "arraybuffer";
    this.dataChannels.set(peerId, dataChannel);

    let currentFileInfo = null;
    let receivedChunks = [];

    dataChannel.onmessage = async (event) => {
      try {
        if (typeof event.data === 'string') {
          const data = JSON.parse(event.data);
          console.log('[DEBUG] Received message type:', data.type);

          switch (data.type) {
            case 'file-start':
              try {
                const downloadPath = await this.fileManager.startFileDownload(peerId, data.name, data.size);
                currentFileInfo = {
                  name: data.name,
                  size: data.size,
                  path: downloadPath,
                  mime: data.mime,
                  lastModified: data.lastModified
                };
                receivedChunks = [];
                this.emit('file-receive-start', {
                  peerId,
                  fileName: data.name,
                  fileSize: data.size,
                  mime: data.mime
                });
                dataChannel.send(JSON.stringify({ type: 'file-ready' }));
              } catch (error) {
                console.error('[DEBUG] Error starting file download:', error);
                dataChannel.send(JSON.stringify({ 
                  type: 'error', 
                  error: 'Failed to start download' 
                }));
              }
              break;

            case 'file-end':
              try {
                if (!currentFileInfo) {
                  throw new Error('Received file-end without file-start');
                }
                
                // Write all chunks to file
                const fileBuffer = Buffer.concat(receivedChunks);
                await fs.writeFile(currentFileInfo.path, fileBuffer);
                
                const filePath = await this.fileManager.completeDownload(peerId);
                this.emit('file-receive-complete', { 
                  peerId, 
                  filePath,
                  fileName: currentFileInfo.name,
                  fileSize: currentFileInfo.size,
                  mime: currentFileInfo.mime
                });
                
                // Reset state
                currentFileInfo = null;
                receivedChunks = [];
              } catch (error) {
                console.error('[DEBUG] Error completing download:', error);
                await this.fileManager.cleanupDownload(peerId);
              }
              break;
          }
        } else {
          // Binary chunk received
          try {
            if (!currentFileInfo) {
              throw new Error('Received binary data without file metadata');
            }
            
            const chunk = Buffer.from(event.data);
            receivedChunks.push(chunk);
            
            const totalReceived = receivedChunks.reduce((sum, c) => sum + c.length, 0);
            this.emit('transfer-progress', {
              peerId,
              progress: (totalReceived / currentFileInfo.size) * 100,
              received: totalReceived,
              total: currentFileInfo.size,
              fileName: currentFileInfo.name
            });
          } catch (error) {
            console.error('[DEBUG] Error processing chunk:', error);
            await this.fileManager.cleanupDownload(peerId);
          }
        }
      } catch (error) {
        console.error('[DEBUG] Error in message handler:', error);
      }
    };

    dataChannel.onopen = () => {
      console.log('[DEBUG] Data channel opened with peer:', peerId);
      this.emit('channel-open', peerId);
    };

    dataChannel.onclose = () => {
      console.log('[DEBUG] Data channel closed with peer:', peerId);
      this.emit('channel-close', peerId);
      this.cleanupPeer(peerId);
    };
  }

  async sendFile(peerId, filePath) {
    console.log('[DEBUG] Starting file send:', { peerId, filePath });
    const dataChannel = this.dataChannels.get(peerId);
    if (!dataChannel || dataChannel.readyState !== 'open') {
      throw new Error('Data channel not ready');
    }

    const fileStats = await fs.stat(filePath);
    const fileName = path.basename(filePath);
    const fileSize = fileStats.size;
    const mime = await this.getMimeType(filePath);

    // Send file metadata and wait for ready signal
    console.log('[DEBUG] Sending file metadata');
    dataChannel.send(JSON.stringify({
      type: 'file-start',
      name: fileName,
      size: fileSize,
      mime: mime,
      lastModified: fileStats.mtimeMs
    }));

    // Wait for ready signal
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout waiting for receiver ready signal'));
      }, 10000);

      const handler = (event) => {
        if (typeof event.data === 'string') {
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'file-ready') {
              clearTimeout(timeout);
              dataChannel.removeEventListener('message', handler);
              resolve();
            }
          } catch (error) {
            console.error('[DEBUG] Error parsing ready signal:', error);
          }
        }
      };
      dataChannel.addEventListener('message', handler);
    });

    try {
      console.log('[DEBUG] Starting chunk transfer');
      const fileBuffer = await fs.readFile(filePath);
      let offset = 0;
      let bytesSent = 0;

      while (offset < fileBuffer.length) {
        const chunk = fileBuffer.slice(offset, offset + this.chunkSize);
        offset += this.chunkSize;
        
        // Send chunk data
        dataChannel.send(chunk);
        bytesSent += chunk.length;

        this.emit('transfer-progress', {
          peerId,
          progress: (bytesSent / fileSize) * 100,
          bytesSent,
          totalBytes: fileSize,
          fileName: fileName
        });

        // Small delay to prevent overwhelming the receiver
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      // Send end signal
      console.log('[DEBUG] File transfer complete, sending end signal');
      dataChannel.send(JSON.stringify({ 
        type: 'file-end'
      }));

      this.emit('transfer-complete', { 
        peerId, 
        fileName,
        fileSize,
        mime
      });
    } catch (error) {
      console.error('[DEBUG] Error in sendFile:', error);
      this.emit('error', error);
      throw error;
    }
  }

  async getMimeType(filePath) {
    const mime = require('mime-types');
    return mime.lookup(filePath) || 'application/octet-stream';
  }

  handleMessage(peerId, message) {
    try {
      const data = JSON.parse(message);
      switch (data.type) {
        case "file-start":
          console.log("Starting file receive:", data);
          this.fileManager
            .startFileDownload(peerId, data.name, data.size)
            .then((downloadPath) => {
              console.log("File will be saved to:", downloadPath);
              this.emit("file-receive-start", {
                peerId,
                fileName: data.name,
                fileSize: data.size,
                downloadPath,
              });
            })
            .catch((error) => {
              console.error("Failed to start file download:", error);
            });
          break;
        case "file-end":
          console.log("Completing file receive");
          this.fileManager
            .completeDownload(peerId)
            .then((filePath) => {
              this.emit("file-receive-complete", { peerId, filePath });
            })
            .catch((error) => {
              console.error("Failed to complete file download:", error);
            });
          break;
        default:
          console.warn("Unknown message type:", data.type);
      }
    } catch (error) {
      // Handle binary data (file chunks)
      console.log("Received file chunk from peer:", peerId);
      this.fileManager
        .writeChunk(peerId, message)
        .then((progress) => {
          this.emit("transfer-progress", {
            peerId,
            ...progress,
          });
        })
        .catch((error) => {
          console.error("Failed to write file chunk:", error);
        });
    }
  }

  async initiateConnection(peerId) {
    const pc = await this.createPeerConnection(peerId, true);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    this.socket.emit("signal", {
      targetPeerId: peerId,
      signal: offer,
    });
  }

  cleanupPeer(peerId) {
    const pc = this.peerConnections.get(peerId);
    if (pc) {
      pc.close();
      this.peerConnections.delete(peerId);
    }
    this.dataChannels.delete(peerId);
    // Clean up any incomplete downloads
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

    // Cleanup all peer connections
    for (const peerId of this.peerConnections.keys()) {
      this.cleanupPeer(peerId);
    }
  }

  async sendChunk(dataChannel, chunk, retries = 3) {
    for (let i = 0; i < retries; i++) {
      try {
        await new Promise((resolve, reject) => {
          dataChannel.send(chunk);
          resolve();
        });
        return;
      } catch (error) {
        if (i === retries - 1) throw error;
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }
}

module.exports = P2PManager;
