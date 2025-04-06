import React, { useState, useEffect } from 'react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { CssBaseline, Container, Box, Typography, CircularProgress } from '@mui/material';
import PeerManager from './components/PeerManager';

const darkTheme = createTheme({
  palette: {
    mode: 'dark',
  },
});

const App = () => {
  const [torStatus, setTorStatus] = useState('not started');

  useEffect(() => {
    const checkTorStatus = async () => {
      const status = await window.electron.statusTor();
      setTorStatus(status);
    };

    // Check initial status
    checkTorStatus();

    // Set up status listener
    const removeTorStatusListener = window.electron.onTorStatus((status) => {
      setTorStatus(status);
    });

    // Start Tor when component mounts
    window.electron.startTor();

    // Clean up when component unmounts
    return () => {
      window.electron.stopTor();
      removeTorStatusListener();
    };
  }, []);

  return (
    <ThemeProvider theme={darkTheme}>
      <CssBaseline />
      <Container maxWidth="md">
        <Box sx={{ mt: 4, mb: 4 }}>
          <Typography variant="h4" component="h1" gutterBottom>
            Tor Share
          </Typography>
          
          <Box sx={{ mb: 3, display: 'flex', alignItems: 'center', gap: 2 }}>
            <Typography variant="body1">
              Tor Status: {torStatus}
            </Typography>
            {torStatus === 'starting' && (
              <CircularProgress size={20} />
            )}
          </Box>

          {torStatus === 'started' ? (
            <PeerManager />
          ) : (
            <Typography variant="body1" color="text.secondary">
              Waiting for Tor to start...
            </Typography>
          )}
        </Box>
      </Container>
    </ThemeProvider>
  );
};

export default App; 