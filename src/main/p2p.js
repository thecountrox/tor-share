const { EventEmitter } = require('events');
const wrtc = require('wrtc');
const { io } = require('socket.io-client');
const { SocksProxyAgent } = require('socks-proxy-agent');
const path = require('path');
const fs = require('fs-extra');

class P2PManager extends EventEmitter {
  constructor() {
    super();
    this.peerConnections = new Map();
    this.dataChannels = new Map();
    this.socket = null;
    this.peerId = null;
    this.configuration = {
      iceServers: [
        {
          urls: 'stun:stun.l.google.com:19302'
        }
      ]
    };
  }

  async connect(onionAddress) {
    // Connect to the signaling server through Tor
    const agent = new SocksProxyAgent('socks5h://127.0.0.1:9050');
    
    this.socket = io(`http://${onionAddress}`, {
      agent,
      transports: ['websocket'],
      upgrade: false
    });

    // Handle signaling server events
    this.socket.on('connect', () => {
      console.log('Connected to signaling server');
      this.socket.emit('discover');
    });

    this.socket.on('peer-id', (id) => {
      console.log('Received peer ID:', id);
      this.peerId = id;
      this.emit('ready', id);
    });

    this.socket.on('peers', (peers) => {
      console.log('Available peers:', peers);
      this.emit('peers', peers);
    });

    this.socket.on('signal', async ({ fromPeerId, signal }) => {
      console.log('Received signal from peer:', fromPeerId);
      await this.handleSignal(fromPeerId, signal);
    });

    this.socket.on('peer-disconnected', (peerId) => {
      console.log('Peer disconnected:', peerId);
      this.cleanupPeer(peerId);
      this.emit('peer-disconnected', peerId);
    });
  }

  async createPeerConnection(peerId, initiator = false) {
    console.log(`Creating peer connection with ${peerId} (initiator: ${initiator})`);
    
    const pc = new wrtc.RTCPeerConnection(this.configuration);
    this.peerConnections.set(peerId, pc);

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.socket.emit('signal', {
          targetPeerId: peerId,
          signal: {
            type: 'candidate',
            candidate: event.candidate
          }
        });
      }
    };

    // Handle data channel
    if (initiator) {
      const dataChannel = pc.createDataChannel('fileTransfer');
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
      if (signal.type === 'offer') {
        await pc.setRemoteDescription(new wrtc.RTCSessionDescription(signal));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        
        this.socket.emit('signal', {
          targetPeerId: peerId,
          signal: answer
        });
      }
      else if (signal.type === 'answer') {
        await pc.setRemoteDescription(new wrtc.RTCSessionDescription(signal));
      }
      else if (signal.type === 'candidate') {
        await pc.addIceCandidate(new wrtc.RTCIceCandidate(signal.candidate));
      }
    } catch (error) {
      console.error('Error handling signal:', error);
    }
  }

  setupDataChannel(peerId, dataChannel) {
    console.log('Setting up data channel for peer:', peerId);
    this.dataChannels.set(peerId, dataChannel);

    dataChannel.onopen = () => {
      console.log('Data channel opened with peer:', peerId);
      this.emit('channel-open', peerId);
    };

    dataChannel.onclose = () => {
      console.log('Data channel closed with peer:', peerId);
      this.emit('channel-close', peerId);
      this.cleanupPeer(peerId);
    };

    dataChannel.onmessage = (event) => {
      this.handleMessage(peerId, event.data);
    };
  }

  async sendFile(peerId, filePath) {
    const dataChannel = this.dataChannels.get(peerId);
    if (!dataChannel || dataChannel.readyState !== 'open') {
      throw new Error('Data channel not ready');
    }

    const fileStats = await fs.stat(filePath);
    const fileName = path.basename(filePath);
    const fileSize = fileStats.size;
    const chunkSize = 16 * 1024; // 16KB chunks

    // Send file metadata
    dataChannel.send(JSON.stringify({
      type: 'file-start',
      name: fileName,
      size: fileSize
    }));

    const fileStream = fs.createReadStream(filePath, { highWaterMark: chunkSize });
    let bytesSent = 0;

    for await (const chunk of fileStream) {
      // Flow control: wait if the buffer is getting full
      if (dataChannel.bufferedAmount > dataChannel.bufferedAmountLowThreshold) {
        await new Promise(resolve => {
          dataChannel.onbufferedamountlow = resolve;
        });
      }

      dataChannel.send(chunk);
      bytesSent += chunk.length;
      this.emit('transfer-progress', {
        peerId,
        progress: (bytesSent / fileSize) * 100
      });
    }

    dataChannel.send(JSON.stringify({ type: 'file-end' }));
    this.emit('transfer-complete', { peerId, fileName });
  }

  handleMessage(peerId, message) {
    try {
      const data = JSON.parse(message);
      switch (data.type) {
        case 'file-start':
          this.emit('file-receive-start', {
            peerId,
            fileName: data.name,
            fileSize: data.size
          });
          break;
        case 'file-end':
          this.emit('file-receive-complete', { peerId });
          break;
        default:
          console.warn('Unknown message type:', data.type);
      }
    } catch (error) {
      // Handle binary data (file chunks)
      this.emit('file-chunk', {
        peerId,
        chunk: message
      });
    }
  }

  async initiateConnection(peerId) {
    const pc = await this.createPeerConnection(peerId, true);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    
    this.socket.emit('signal', {
      targetPeerId: peerId,
      signal: offer
    });
  }

  cleanupPeer(peerId) {
    const pc = this.peerConnections.get(peerId);
    if (pc) {
      pc.close();
      this.peerConnections.delete(peerId);
    }
    this.dataChannels.delete(peerId);
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    
    // Cleanup all peer connections
    for (const peerId of this.peerConnections.keys()) {
      this.cleanupPeer(peerId);
    }
  }
}

module.exports = P2PManager; 