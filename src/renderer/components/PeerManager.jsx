import React, { useState, useEffect } from 'react';
import { Box, Button, List, ListItem, ListItemText, Typography, LinearProgress } from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';

const PeerManager = () => {
  const [selfId, setSelfId] = useState(null);
  const [peers, setPeers] = useState([]);
  const [transfers, setTransfers] = useState({});
  const [selectedFile, setSelectedFile] = useState(null);
  const [connectedPeers, setConnectedPeers] = useState(new Set());

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
            status: prev[data.peerId]?.status || 'unknown'
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
    
    const removeTransferErrorListener = window.electron.onTransferError && window.electron.onTransferError((error) => {
      console.error('[DEBUG-UI] Transfer error:', error);
    });

    // Clean up event listeners when component unmounts
    return () => {
      console.log('[DEBUG-UI] Cleaning up event listeners');
      removeSelfIdListener();
      removePeerListListener();
      removeTransferProgressListener();
      removeChannelOpenListener();
      if (removeTransferErrorListener) removeTransferErrorListener();
      removeFileReceiveStartListener();
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
        [peerId]: { progress: 0, status: 'sending' }
      }));
    } catch (error) {
      console.error('Failed to send file:', error);
    }
  };

  const handleRefresh = () => {
    window.electron.refreshPeers(); // This will trigger a new discover event
  };

  return (
    <Box sx={{ p: 2 }}>
      <Typography variant="h6" gutterBottom>
        Your ID: {selfId || 'Connecting...'}
      </Typography>

      <Button
        variant="contained"
        onClick={handleFileSelect}
        sx={{ mb: 2 }}
      >
        Select File
      </Button>

      {selectedFile && (
        <Typography variant="body2" sx={{ mb: 2 }}>
          Selected file: {selectedFile.name}
        </Typography>
      )}

      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
        <Typography variant="h6">Connected Peers</Typography>
        <Button 
          variant="outlined" 
          onClick={handleRefresh}
          startIcon={<RefreshIcon />}
        >
          Refresh
        </Button>
      </Box>

      <List>
        {peers.map((peerId) => (
          <ListItem key={peerId}>
            <ListItemText
              primary={`Peer ${peerId}`}
              secondary={
                <Box>
                  <Typography variant="body2">
                    {connectedPeers.has(peerId) ? 'Connected' : 'Not connected'}
                  </Typography>
                  {transfers[peerId] && (
                    <>
                      <Typography variant="body2">
                        {transfers[peerId].status}
                      </Typography>
                      <LinearProgress
                        variant="determinate"
                        value={transfers[peerId].progress * 100}
                      />
                    </>
                  )}
                </Box>
              }
            />
            <Button
              variant="contained"
              onClick={() => handleSendFile(peerId)}
              disabled={!selectedFile}
            >
              Send File
            </Button>
          </ListItem>
        ))}
      </List>

      {peers.length === 0 && (
        <Typography variant="body1" color="text.secondary">
          No peers connected
        </Typography>
      )}
    </Box>
  );
};

export default PeerManager; 