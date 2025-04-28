import React, { useState, useEffect } from 'react';
import {
  Paper,
  Typography,
  List,
  ListItem,
  ListItemText,
  Button,
  Box,
  LinearProgress,
  Alert,
} from '@mui/material';

const ClientManager = () => {
  const [clients, setClients] = useState([]);
  const [transfers, setTransfers] = useState(new Map());
  const [error, setError] = useState('');

  useEffect(() => {
    // Get initial client list
    window.electron.getConnectedClients().then(clients => {
      console.log(`Renderer: Received initial client list with ${clients.length} clients`);
      setClients(clients);
    });

    // Set up event listeners
    const cleanups = [
      window.electron.onClientsUpdated(updatedClients => {
        console.log(`Renderer: Received clients update with ${updatedClients.length} clients`);
        setClients(updatedClients);
      }),
      window.electron.onTransferRequest((data) => {
        const { fromClientId, fileName, fileSize } = data;
        console.log(`Renderer: Received transfer request from ${fromClientId} for file ${fileName} (${fileSize} bytes)`);
        
        setTransfers((prev) => {
          const newTransfers = new Map(prev);
          newTransfers.set(fromClientId, {
            fileName,
            fileSize,
            status: 'pending',
            progress: 0
          });
          return newTransfers;
        });
      }),
      window.electron.onTransferStatusUpdate((data) => {
        const { clientId, status, fileName, filePath, fileSize } = data;
        console.log(`Renderer: Transfer status update for ${clientId}: ${status}`);
        
        setTransfers((prev) => {
          const newTransfers = new Map(prev);
          const transfer = newTransfers.get(clientId) || {};
          
          newTransfers.set(clientId, {
            ...transfer,
            fileName: fileName || transfer.fileName,
            fileSize: fileSize || transfer.fileSize,
            filePath: filePath || transfer.filePath,
            status: status || transfer.status
          });
          
          return newTransfers;
        });
      }),
      window.electron.onTransferProgress((data) => {
        const { targetClientId, progress, bytesSent, totalBytes } = data;
        console.log(`Renderer: Transfer progress update for ${targetClientId}: ${progress.toFixed(2)}% (${bytesSent}/${totalBytes} bytes)`);
        
        setTransfers((prev) => {
          const newTransfers = new Map(prev);
          const transfer = newTransfers.get(targetClientId);
          if (transfer) {
            transfer.progress = progress;
            transfer.status = 'transferring';
            transfer.bytesSent = bytesSent;
            transfer.totalBytes = totalBytes;
          }
          return newTransfers;
        });
      }),
      window.electron.onTransferComplete((data) => {
        const { targetClientId } = data;
        console.log(`Renderer: Transfer complete for ${targetClientId}`);
        
        setTransfers((prev) => {
          const newTransfers = new Map(prev);
          const transfer = newTransfers.get(targetClientId);
          if (transfer) {
            transfer.status = 'completed';
            transfer.progress = 100;
            
            // Auto-clear completed transfers after 5 seconds
            setTimeout(() => {
              setTransfers(current => {
                const updated = new Map(current);
                updated.delete(targetClientId);
                return updated;
              });
            }, 5000);
          }
          return newTransfers;
        });
      }),
      window.electron.onTransferError((data) => {
        const { clientId, error } = data;
        console.error(`Renderer: Transfer error for ${clientId}: ${error}`);
        
        setTransfers((prev) => {
          const newTransfers = new Map(prev);
          const transfer = newTransfers.get(clientId);
          if (transfer) {
            transfer.status = 'error';
            transfer.error = error;
            
            // Auto-clear errored transfers after 10 seconds
            setTimeout(() => {
              setTransfers(current => {
                const updated = new Map(current);
                updated.delete(clientId);
                return updated;
              });
            }, 10000);
          }
          return newTransfers;
        });
        
        setError(`Transfer error: ${error}`);
      })
    ];

    return () => cleanups.forEach(cleanup => cleanup());
  }, []);

  const handleSendFile = async (targetClientId) => {
    try {
      console.log(`[RENDERER] Selecting file to send to ${targetClientId}`);
      const file = await window.electron.selectFile();
      
      if (file) {
        console.log(`[RENDERER] Selected file: ${file.name}, path: ${file.path}, size: ${file.size} bytes`);
        
        setTransfers((prev) => {
          const newTransfers = new Map(prev);
          newTransfers.set(targetClientId, {
            fileName: file.name,
            fileSize: file.size,
            status: 'sending',
            progress: 0
          });
          return newTransfers;
        });
        
        console.log(`[RENDERER] Initiating file transfer to client ${targetClientId}`);
        const result = await window.electron.sendFile(targetClientId, file.path);
        console.log(`[RENDERER] Send file result:`, result);
        
        if (!result.success) {
          console.error(`[RENDERER] Error sending file:`, result.error);
          setError(result.error || 'Failed to send file');
          
          // Update transfer status to error
          setTransfers((prev) => {
            const newTransfers = new Map(prev);
            const transfer = newTransfers.get(targetClientId);
            if (transfer) {
              transfer.status = 'error';
              transfer.error = result.error;
            }
            return newTransfers;
          });
        }
      } else {
        console.log(`[RENDERER] No file selected, cancelling send operation`);
      }
    } catch (err) {
      console.error(`[RENDERER] Error in handleSendFile:`, err);
      setError(err.message);
      
      // Update transfer status to error
      setTransfers((prev) => {
        const newTransfers = new Map(prev);
        const transfer = newTransfers.get(targetClientId);
        if (transfer) {
          transfer.status = 'error';
          transfer.error = err.message;
        }
        return newTransfers;
      });
    }
  };

  const handleAcceptTransfer = async (fromClientId, fileName) => {
    try {
      await window.electron.acceptTransfer(fromClientId, fileName);
      setTransfers((prev) => {
        const newTransfers = new Map(prev);
        const transfer = newTransfers.get(fromClientId);
        if (transfer) {
          transfer.status = 'receiving';
        }
        return newTransfers;
      });
    } catch (err) {
      setError(err.message);
    }
  };

  const handleRejectTransfer = async (fromClientId) => {
    try {
      await window.electron.rejectTransfer(fromClientId);
      setTransfers((prev) => {
        const newTransfers = new Map(prev);
        newTransfers.delete(fromClientId);
        return newTransfers;
      });
    } catch (err) {
      setError(err.message);
    }
  };

  // Add refresh function
  const refreshClients = async () => {
    try {
      await window.electron.refreshClients();
    } catch (err) {
      setError(err.message);
    }
  };

  // Add a utility function to format file sizes
  const formatFileSize = (bytes) => {
    if (bytes < 1024) return bytes + ' B';
    else if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    else if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    else return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  };

  return (
    <Paper sx={{ p: 2 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6" component="h2">
          Connected Clients
        </Typography>
        <Button 
          variant="outlined" 
          size="small"
          onClick={refreshClients}
        >
          Refresh
        </Button>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
          {error}
        </Alert>
      )}

      <List>
        {clients.map((client) => (
          <ListItem
            key={client.id}
            secondaryAction={
              <Button
                variant="contained"
                size="small"
                onClick={() => handleSendFile(client.id)}
                disabled={transfers.has(client.id)}
              >
                Send File
              </Button>
            }
          >
            <ListItemText
              primary={`Client ${client.id.slice(0, 8)}...`}
              secondary={
                transfers.has(client.id) && (
                  <Box sx={{ width: '100%', mt: 1 }}>
                    <Typography variant="body2" color="text.secondary">
                      {transfers.get(client.id).fileName} - {transfers.get(client.id).status}
                      {transfers.get(client.id).bytesSent && transfers.get(client.id).totalBytes && (
                        ` (${formatFileSize(transfers.get(client.id).bytesSent)} / ${formatFileSize(transfers.get(client.id).totalBytes)})`
                      )}
                    </Typography>
                    <LinearProgress
                      variant={transfers.get(client.id).progress > 0 ? "determinate" : "indeterminate"}
                      value={transfers.get(client.id).progress}
                      color={transfers.get(client.id).status === 'error' ? 'error' : 'primary'}
                      sx={{ mt: 1 }}
                    />
                    {transfers.get(client.id).status === 'pending' && (
                      <Box sx={{ mt: 1 }}>
                        <Button
                          size="small"
                          onClick={() => handleAcceptTransfer(client.id, transfers.get(client.id).fileName)}
                          sx={{ mr: 1 }}
                        >
                          Accept
                        </Button>
                        <Button
                          size="small"
                          color="error"
                          onClick={() => handleRejectTransfer(client.id)}
                        >
                          Reject
                        </Button>
                      </Box>
                    )}
                    {transfers.get(client.id).status === 'error' && (
                      <Typography variant="body2" color="error" sx={{ mt: 1 }}>
                        {transfers.get(client.id).error}
                      </Typography>
                    )}
                  </Box>
                )
              }
            />
          </ListItem>
        ))}
        {clients.length === 0 && (
          <ListItem>
            <ListItemText primary="No clients connected" />
          </ListItem>
        )}
      </List>
    </Paper>
  );
};

export default ClientManager; 