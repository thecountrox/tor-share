import React, { useState, useEffect } from 'react';
import { Paper, Typography, CircularProgress, Button, Alert } from '@mui/material';

const TorStatus = () => {
  const [status, setStatus] = useState('not started');
  const [error, setError] = useState('');
  const [isRetrying, setIsRetrying] = useState(false);

  useEffect(() => {
    const cleanup = window.electron.onTorStatus((status) => {
      setStatus(status);
      if (status === 'error') {
        setError('Failed to start Tor. Check if Tor is installed and running.');
      } else {
        setError('');
      }
    });

    const errorCleanup = window.electron.onError?.((errorMessage) => {
      if (errorMessage.includes('Tor')) {
        setError(errorMessage);
      }
    });

    return () => {
      cleanup();
      if (errorCleanup) errorCleanup();
    };
  }, []);

  const handleRetry = async () => {
    setIsRetrying(true);
    try {
      await window.electron.startTor();
      setIsRetrying(false);
    } catch (err) {
      setError(`Failed to start Tor: ${err.message}`);
      setIsRetrying(false);
    }
  };

  return (
    <Paper sx={{ p: 2, mb: 2 }}>
      <Typography variant="h6" component="h2" gutterBottom>
        Tor Status
      </Typography>
      <Typography variant="body1" color={status === 'started' ? 'success.main' : 'text.primary'}>
        {status === 'starting' || isRetrying ? (
          <>
            Starting Tor... <CircularProgress size={20} />
          </>
        ) : (
          `Status: ${status}`
        )}
      </Typography>
      
      {error && (
        <Alert severity="error" sx={{ mt: 2, mb: 2 }}>
          {error}
        </Alert>
      )}
      
      {(status === 'error' || status === 'not started') && (
        <Button 
          variant="contained" 
          color="primary" 
          onClick={handleRetry}
          disabled={isRetrying || status === 'starting'}
          sx={{ mt: 2 }}
        >
          Retry Tor Connection
        </Button>
      )}
    </Paper>
  );
};

export default TorStatus; 