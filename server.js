const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

console.log('Starting Tor Share Signaling Server...');

// Create the Express app and HTTP server
const app = express();
const server = http.createServer(app);

// Set up Socket.IO with CORS enabled
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

// Store connected clients
const clients = new Map();

// Log connected clients periodically
setInterval(() => {
  const clientList = Array.from(clients.keys());
  console.log(`[SERVER STATUS] ${clients.size} clients connected`);
  if (clients.size > 0) {
    console.log(`[SERVER STATUS] Client IDs: ${clientList.join(', ')}`);
  }
}, 60000); // Log every minute

// Basic status endpoint
app.get('/', (req, res) => {
  res.send('Tor Share Signaling Server is running');
});

// Status API endpoint
app.get('/status', (req, res) => {
  res.json({
    status: 'running',
    clientCount: clients.size,
    uptime: process.uptime()
  });
});

// Set up socket.io event handlers
io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);

  // Generate a unique client ID
  const clientId = crypto.randomBytes(16).toString('hex');
  clients.set(clientId, socket);

  // Send the client ID to the client
  socket.emit('client-id', clientId);
  console.log(`Assigned ID ${clientId} to client ${socket.id}`);
  console.log(`[SERVER STATUS] Total clients connected: ${clients.size}`);

  // Handle client discovery
  socket.on('discover', () => {
    const clientList = Array.from(clients.keys()).filter(id => id !== clientId);
    console.log(`Client ${clientId} requested discovery, sending list of ${clientList.length} clients`);
    if (clientList.length > 0) {
      console.log(`[SERVER] Available clients: ${clientList.join(', ')}`);
    } else {
      console.log('[SERVER] No other clients available');
    }
    socket.emit('clients', clientList);
  });

  // Handle file transfer requests
  socket.on('transfer-request', ({ targetClientId, metadata }) => {
    console.log(`Transfer request from ${clientId} to ${targetClientId}`);
    
    const targetClient = clients.get(targetClientId);
    if (targetClient) {
      targetClient.emit('transfer-request', {
        fromClientId: clientId,
        fileName: metadata.name,
        fileSize: metadata.size
      });
    } else {
      console.log(`Target client ${targetClientId} not found`);
    }
  });

  // Handle transfer responses
  socket.on('transfer-response', ({ targetClientId, accept }) => {
    console.log(`Transfer response from ${clientId} to ${targetClientId}: ${accept ? 'accepted' : 'rejected'}`);
    
    const targetClient = clients.get(targetClientId);
    if (targetClient) {
      targetClient.emit('transfer-response', {
        fromClientId: clientId,
        accept
      });
    } else {
      console.log(`Target client ${targetClientId} not found`);
    }
  });

  // Handle file chunks
  socket.on('file-chunk', ({ targetClientId, chunk }) => {
    const targetClient = clients.get(targetClientId);
    if (targetClient) {
      targetClient.emit('file-chunk', {
        fromClientId: clientId,
        chunk
      });
    }
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${clientId}`);
    clients.delete(clientId);
    
    // Log updated client count
    console.log(`[SERVER STATUS] Client ${clientId} disconnected, ${clients.size} clients remaining`);
    if (clients.size > 0) {
      console.log(`[SERVER STATUS] Remaining clients: ${Array.from(clients.keys()).join(', ')}`);
    }
    
    // Notify other clients about the disconnection
    io.emit('client-disconnected', clientId);
  });
});

// Start the server on port 3000 by default, or use the PORT environment variable
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Signaling server listening on port ${PORT}`);
  console.log(`Server has ${clients.size} connected clients`);
  console.log('To access via Tor, make sure this port is forwarded to your hidden service');
});

// Save the onion address to a file if available
const ONION_ADDRESS = process.env.ONION_ADDRESS;
if (ONION_ADDRESS) {
  console.log(`Onion address: ${ONION_ADDRESS}`);
  
  // Create a file with the onion address for easy sharing
  fs.writeFileSync('onion_address.txt', ONION_ADDRESS);
  console.log('Saved onion address to onion_address.txt');
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down signaling server...');
  io.close();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
}); 