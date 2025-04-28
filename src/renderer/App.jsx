import React from 'react';
import { Container, Box, Typography } from '@mui/material';
import TorStatus from './components/TorStatus';
import ClientManager from './components/ClientManager';
import SignalingConfig from './components/SignalingConfig';

const App = () => {
  return (
    <Container maxWidth="lg">
      <Box sx={{ my: 4 }}>
        <Typography variant="h4" component="h1" gutterBottom>
          Tor Share
        </Typography>
        
        <TorStatus />
        <SignalingConfig />
        <ClientManager />
      </Box>
    </Container>
  );
};

export default App; 