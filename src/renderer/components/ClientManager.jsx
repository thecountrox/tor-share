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
        setTransfers((prev) => new Map(prev).set(fromClientId, {
          fileName,
          fileSize,
          status: 'pending',
          progress: 0
        }));
      }),
      window.electron.onTransferProgress((data) => {
        const { targetClientId, progress } = data;
        setTransfers((prev) => {
          const newTransfers = new Map(prev);
          const transfer = newTransfers.get(targetClientId);
          if (transfer) {
            transfer.progress = progress;
            transfer.status = 'transferring';
          }
          return newTransfers;
        });
      }),
      window.electron.onTransferComplete((data) => {
        const { targetClientId } = data;
        setTransfers((prev) => {
          const newTransfers = new Map(prev);
          const transfer = newTransfers.get(targetClientId);
          if (transfer) {
            transfer.status = 'completed';
            transfer.progress = 100;
          }
          return newTransfers;
        });
      }),
      window.electron.onTransferError((data) => {
        const { clientId, error } = data;
        setTransfers((prev) => {
          const newTransfers = new Map(prev);
          const transfer = newTransfers.get(clientId);
          if (transfer) {
            transfer.status = 'error';
            transfer.error = error;
          }
          return newTransfers;
        });
      })
    ];

    return () => cleanups.forEach(cleanup => cleanup());
  }, []);

  const handleSendFile = async (targetClientId) => {
    try {
      const file = await window.electron.selectFile();
      if (file) {
        await window.electron.sendFile(targetClientId, file.path);
        setTransfers((prev) => new Map(prev).set(targetClientId, {
          fileName: file.name,
          fileSize: file.size,
          status: 'sending',
          progress: 0
        }));
      }
    } catch (err) {
      setError(err.message);
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
                    </Typography>
                    <LinearProgress
                      variant="determinate"
                      value={transfers.get(client.id).progress}
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