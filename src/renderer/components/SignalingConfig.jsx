import React, { useState, useEffect } from 'react';
import { Paper, Typography, TextField, Button, Box, Alert } from '@mui/material';

const SignalingConfig = () => {
  const [serverUrl, setServerUrl] = useState('');
  const [status, setStatus] = useState('disconnected');
  const [error, setError] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);

  useEffect(() => {
    // Get saved server URL
    const loadServerUrl = async () => {
      try {
        const savedUrl = await window.electron.getSignalingServer();
        if (savedUrl) {
          setServerUrl(savedUrl);
        }
      } catch (err) {
        console.error('Failed to load server URL:', err);
      }
    };
    loadServerUrl();

    // Set up status listener
    const cleanup = window.electron.onSignalingStatus((newStatus) => {
      setStatus(newStatus);
      setIsConnecting(false);
      if (newStatus === 'error') {
        setError('Failed to connect to signaling server');
      } else {
        setError('');
      }
    });

    return () => cleanup();
  }, []);

  const handleSave = async () => {
    try {
      setError('');
      setIsConnecting(true);

      // Basic URL validation
      const trimmedUrl = serverUrl.trim();
      if (!trimmedUrl) {
        setError('Server URL cannot be empty');
        setIsConnecting(false);
        return;
      }

      if (!trimmedUrl.endsWith('.onion')) {
        setError('Server URL must be a .onion address');
        setIsConnecting(false);
        return;
      }

      const success = await window.electron.setSignalingServer(trimmedUrl);
      if (!success) {
        setError('Failed to connect to signaling server');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setIsConnecting(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      handleSave();
    }
  };

  return (
    <Paper sx={{ p: 2, mb: 2 }}>
      <Typography variant="h6" component="h2" gutterBottom>
        Signaling Server Configuration
      </Typography>
      
      <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start', mb: 2 }}>
        <TextField
          label="Server URL"
          variant="outlined"
          value={serverUrl}
          onChange={(e) => setServerUrl(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder="Enter .onion address"
          fullWidth
          error={!!error}
          helperText={error || "Enter the signaling server's .onion address"}
          disabled={isConnecting}
        />
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={isConnecting}
        >
          {isConnecting ? 'Connecting...' : 'Connect'}
        </Button>
      </Box>

      <Typography variant="body2" color="text.secondary">
        Status: {status}
      </Typography>
    </Paper>
  );
};

export default SignalingConfig; 