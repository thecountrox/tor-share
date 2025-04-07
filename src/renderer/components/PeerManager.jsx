import React, { useState, useEffect } from 'react';
import { Box, Button, List, ListItem, ListItemText, Typography, LinearProgress } from '@mui/material';

const PeerManager = () => {
  const [selfId, setSelfId] = useState(null);
  const [peers, setPeers] = useState([]);
  const [transfers, setTransfers] = useState({});
  const [selectedFile, setSelectedFile] = useState(null);

  useEffect(() => {
    // Set up event listeners when component mounts
    const removeSelfIdListener = window.electron.onSelfId((id) => setSelfId(id));
    const removePeerListListener = window.electron.onPeerList((peerList) => setPeers(peerList));
    const removeTransferProgressListener = window.electron.onTransferProgress((data) => {
      setTransfers((prev) => ({
        ...prev,
        [data.peerId]: {
          ...prev[data.peerId],
          progress: data.progress,
          status: data.status
        }
      }));
    });

    // Clean up event listeners when component unmounts
    return () => {
      removeSelfIdListener();
      removePeerListListener();
      removeTransferProgressListener();
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
      await window.electron.sendFile(peerId, selectedFile.path);
      setTransfers((prev) => ({
        ...prev,
        [peerId]: { progress: 0, status: 'sending' }
      }));
    } catch (error) {
      console.error('Failed to send file:', error);
    }
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

      <Typography variant="h6" gutterBottom>
        Connected Peers
      </Typography>

      <List>
        {peers.map((peerId) => (
          <ListItem key={peerId}>
            <ListItemText
              primary={`Peer ${peerId}`}
              secondary={
                transfers[peerId] ? (
                  <Box>
                    <Typography variant="body2">
                      {transfers[peerId].status}
                    </Typography>
                    <LinearProgress
                      variant="determinate"
                      value={transfers[peerId].progress * 100}
                    />
                  </Box>
                ) : null
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