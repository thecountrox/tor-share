# Tor Share Signaling Server

This is the signaling server for the Tor Share application. It handles client discovery and facilitates file transfers between clients over the Tor network.

## Prerequisites

- Node.js 14+ installed
- Access to a server where you can run Node.js applications
- (Optional) Tor installed for hidden service setup

## Installation

1. Clone or copy these files to your server
2. Rename `server-package.json` to `package.json`
3. Install dependencies:
   ```
   npm install
   ```

## Running the Server

### Standard Start
```
npm start
```

### Development Mode (with auto-restart)
```
npm run dev
```

The server will start on port 3000 by default. You can change this by setting the `PORT` environment variable.

## Setting up as a Tor Hidden Service

1. Install Tor on your server if not already installed
2. Edit your `torrc` file (usually in `/etc/tor/torrc`) and add:
   ```
   HiddenServiceDir /var/lib/tor/tor-share/
   HiddenServicePort 80 127.0.0.1:3000
   ```
3. Restart Tor:
   ```
   sudo systemctl restart tor
   ```
4. Get your .onion address:
   ```
   sudo cat /var/lib/tor/tor-share/hostname
   ```
5. Run the server with your onion address as an environment variable:
   ```
   ONION_ADDRESS=youronionaddress.onion npm start
   ```

## Configuring Clients

In the Tor Share client application, enter your server's onion address in the "Signaling Server" configuration.

## Security Considerations

- This server doesn't implement authentication - anyone who knows the onion address can connect
- All communication between clients is end-to-end encrypted by the client application
- The server only relays messages and doesn't have access to the content of file transfers

## Troubleshooting

1. Check if the server is running by visiting http://localhost:3000/status (locally) or through Tor Browser
2. Ensure your firewall allows connections on port 3000
3. Verify Tor is running and your hidden service is properly configured
4. Check the console logs for any error messages 