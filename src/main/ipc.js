const { ipcMain, dialog } = require('electron');
const { join } = require('path');
const { createReadStream, createWriteStream } = require('fs');
const { pipeline } = require('stream/promises');

class IPCHandler {
  constructor(mainWindow, p2pManager) {
    this.mainWindow = mainWindow;
    this.p2pManager = p2pManager;
    this.transfers = new Map();
    this.setupHandlers();
  }

  setupHandlers() {
    // Client management
    ipcMain.handle('get-connected-clients', () => {
      return this.p2pManager.getConnectedClients();
    });

    // File selection
    ipcMain.handle('select-file', async () => {
      const result = await dialog.showOpenDialog(this.mainWindow, {
        properties: ['openFile']
      });
      if (!result.canceled) {
        return result.filePaths[0];
      }
      return null;
    });

    // File transfer
    ipcMain.handle('send-file', async (event, targetClientId, filePath) => {
      try {
        const stream = createReadStream(filePath);
        const fileName = filePath.split('/').pop();
        
        await this.p2pManager.sendFile(targetClientId, fileName, stream, {
          onProgress: (progress) => {
            this.mainWindow.webContents.send('transfer-progress', {
              clientId: targetClientId,
              fileName,
              progress
            });
          }
        });

        this.mainWindow.webContents.send('transfer-complete', {
          clientId: targetClientId,
          fileName
        });
      } catch (error) {
        this.mainWindow.webContents.send('transfer-error', {
          clientId: targetClientId,
          error: error.message
        });
      }
    });

    ipcMain.handle('accept-transfer', async (event, fromClientId, fileName) => {
      try {
        const savePath = join(app.getPath('downloads'), fileName);
        const writeStream = createWriteStream(savePath);

        await this.p2pManager.acceptTransfer(fromClientId, writeStream, {
          onProgress: (progress) => {
            this.mainWindow.webContents.send('transfer-progress', {
              clientId: fromClientId,
              fileName,
              progress
            });
          }
        });

        this.mainWindow.webContents.send('transfer-complete', {
          clientId: fromClientId,
          fileName
        });
      } catch (error) {
        this.mainWindow.webContents.send('transfer-error', {
          clientId: fromClientId,
          error: error.message
        });
      }
    });

    ipcMain.handle('reject-transfer', async (event, fromClientId) => {
      await this.p2pManager.rejectTransfer(fromClientId);
    });

    // Listen for P2P events
    this.p2pManager.on('clients-updated', (clients) => {
      this.mainWindow.webContents.send('clients-updated', clients);
    });

    this.p2pManager.on('transfer-request', (data) => {
      this.mainWindow.webContents.send('transfer-request', data);
    });
  }
}

module.exports = IPCHandler; 