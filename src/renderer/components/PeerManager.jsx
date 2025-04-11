import React, { useState, useEffect } from 'react';
import { 
  Box, 
  Button, 
  List, 
  ListItem, 
  ListItemText, 
  Typography, 
  LinearProgress,
  Chip,
  Alert,
  Snackbar,
  CircularProgress,
  Tooltip,
  IconButton
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import ErrorIcon from '@mui/icons-material/Error';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import DeleteIcon from '@mui/icons-material/Delete';

const PeerManager = () => {
  const [selfId, setSelfId] = useState(null);
  const [peers, setPeers] = useState([]);
  const [transfers, setTransfers] = useState({});
  const [selectedFile, setSelectedFile] = useState(null);
  const [connectedPeers, setConnectedPeers] = useState(new Set());
  const [error, setError] = useState(null);

  useEffect(() => {
    // Set up event listeners when component mounts
    console.log('[DEBUG-UI] Setting up event listeners');
    
    const removeSelfIdListener = window.electron.onSelfId((id) => {
      console.log('[DEBUG-UI] Received self ID:', id);
      setSelfId(id);
    });
    
    const removePeerListListener = window.electron.onPeerList((peerList) => {
      console.log('[DEBUG-UI] Received peer list:', peerList);
      setPeers(peerList);
    });
    
    const removeTransferProgressListener = window.electron.onTransferProgress((data) => {
      console.log('[DEBUG-UI] Received transfer progress:', data);
      try {
        setTransfers((prev) => ({
          ...prev,
          [data.peerId]: {
            ...prev[data.peerId],
            progress: data.progress,
            received: data.received,
            total: data.total,
            fileName: data.fileName,
            transferSpeed: data.transferSpeed,
            status: prev[data.peerId]?.status || 'transferring'
          }
        }));
      } catch (error) {
        console.error('[DEBUG-UI] Error updating transfer progress:', error);
      }
    });
    
    const removeChannelOpenListener = window.electron.onPeerConnected((peerId) => {
      console.log('[DEBUG-UI] Channel opened with peer:', peerId);
      try {
        setConnectedPeers(prev => new Set([...prev, peerId]));
      } catch (error) {
        console.error('[DEBUG-UI] Error updating connected peers:', error);
      }
    });

    const removeFileReceiveStartListener = window.electron.onFileReceiveStart((data) => {
      console.log('[DEBUG-UI] Received file-receive-start event:', data);
      try {
        setTransfers((prev) => {
          console.log('[DEBUG-UI] Current transfers state:', prev);
          const newState = {
            ...prev,
            [data.peerId]: {
              ...prev[data.peerId],
              fileName: data.fileName,
              fileSize: data.fileSize,
              mime: data.mime,
              progress: 0,
              status: 'receiving'
            }
          };
          console.log('[DEBUG-UI] New transfers state:', newState);
          return newState;
        });
      } catch (error) {
        console.error('[DEBUG-UI] Error updating transfers for file receive start:', error);
      }
    });

    const removeTransferCompleteListener = window.electron.onTransferComplete((data) => {
      console.log('[DEBUG-UI] Transfer complete:', data);
      setTransfers((prev) => ({
        ...prev,
        [data.peerId]: {
          ...prev[data.peerId],
          status: 'complete',
          progress: 100
        }
      }));
    });

    const removeTransferErrorListener = window.electron.onTransferError((error) => {
      console.error('[DEBUG-UI] Transfer error:', error);
      setError(error.message || 'Transfer failed');
      setTransfers((prev) => ({
        ...prev,
        [error.peerId]: {
          ...prev[error.peerId],
          status: 'error',
          error: error.message
        }
      }));
    });

    // Clean up event listeners when component unmounts
    return () => {
      console.log('[DEBUG-UI] Cleaning up event listeners');
      removeSelfIdListener();
      removePeerListListener();
      removeTransferProgressListener();
      removeChannelOpenListener();
      removeTransferErrorListener();
      removeFileReceiveStartListener();
      removeTransferCompleteListener();
    };
  }, []);

  const handleFileSelect = async () => {
    const file = await window.electron.selectFile();
    if (file) {
      setSelectedFile(file);
    }
  };

  const handleSendFile = async (peerId) => {
    if (!selectedFile) return;
    try {
      // First ensure we have a connection
      if (!connectedPeers.has(peerId)) {
        await window.electron.connectPeer(peerId);
        // Wait for the connection to be established
        await new Promise((resolve) => {
          const checkConnection = setInterval(() => {
            if (connectedPeers.has(peerId)) {
              clearInterval(checkConnection);
              resolve();
            }
          }, 100);
        });
      }
      
      // Now send the file
      await window.electron.sendFile(peerId, selectedFile.path);
      setTransfers((prev) => ({
        ...prev,
        [peerId]: { 
          progress: 0, 
          status: 'sending',
          fileName: selectedFile.name
        }
      }));
    } catch (error) {
      console.error('Failed to send file:', error);
      setError(error.message);
    }
  };

  const handleRefresh = () => {
    window.electron.refreshPeers();
  };

  const handleClearTransfer = (peerId) => {
    setTransfers((prev) => {
      const newState = { ...prev };
      delete newState[peerId];
      return newState;
    });
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  };

  const getTransferStatusColor = (status) => {
    switch (status) {
      case 'transferring':
      case 'sending':
      case 'receiving':
        return 'primary';
      case 'complete':
        return 'success';
      case 'error':
        return 'error';
      default:
        return 'default';
    }
  };

  return (
    <Box sx={{ p: 2 }}>
      <Typography variant="h5" gutterBottom>
        Tor Share
      </Typography>
      
      <Box sx={{ mb: 2, display: 'flex', gap: 2 }}>
        <Button variant="contained" onClick={handleFileSelect}>
          Select File
        </Button>
        <Button variant="outlined" onClick={handleRefresh} startIcon={<RefreshIcon />}>
          Refresh Peers
        </Button>
      </Box>

      {selectedFile && (
        <Typography variant="body1" sx={{ mb: 2 }}>
          Selected file: {selectedFile.name} ({formatFileSize(selectedFile.size)})
        </Typography>
      )}

      <Typography variant="h6" gutterBottom>
        Available Peers
      </Typography>
      
      <List>
        {peers.map((peer) => (
          <ListItem 
            key={peer} 
            sx={{ 
              border: '1px solid #ccc', 
              borderRadius: 1, 
              mb: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start'
            }}
          >
            <Box sx={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <ListItemText 
                primary={peer} 
                secondary={connectedPeers.has(peer) ? 'Connected' : 'Not connected'} 
              />
              {selectedFile && (
                <Button 
                  variant="contained" 
                  onClick={() => handleSendFile(peer)}
                  disabled={!connectedPeers.has(peer)}
                >
                  Send File
                </Button>
              )}
            </Box>

            {transfers[peer] && (
              <Box sx={{ width: '100%', mt: 1 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                  <Typography variant="body2">
                    {transfers[peer].fileName} - {formatFileSize(transfers[peer].received || 0)} / {formatFileSize(transfers[peer].total || 0)}
                  </Typography>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    {transfers[peer].transferSpeed && (
                      <Typography variant="body2">
                        {transfers[peer].transferSpeed} KB/s
                      </Typography>
                    )}
                    <Chip 
                      label={transfers[peer].status} 
                      color={getTransferStatusColor(transfers[peer].status)}
                      size="small"
                    />
                    {transfers[peer].status === 'complete' && (
                      <Tooltip title="Clear transfer">
                        <IconButton size="small" onClick={() => handleClearTransfer(peer)}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                  </Box>
                </Box>
                <LinearProgress 
                  variant="determinate" 
                  value={transfers[peer].progress} 
                  color={getTransferStatusColor(transfers[peer].status)}
                />
                {transfers[peer].status === 'error' && (
                  <Typography variant="body2" color="error" sx={{ mt: 1 }}>
                    {transfers[peer].error}
                  </Typography>
                )}
              </Box>
            )}
          </ListItem>
        ))}
      </List>

      <Snackbar 
        open={!!error} 
        autoHideDuration={6000} 
        onClose={() => setError(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert onClose={() => setError(null)} severity="error" sx={{ width: '100%' }}>
          {error}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default PeerManager; 