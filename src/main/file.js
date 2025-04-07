const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');

class FileManager {
  constructor(downloadDir) {
    this.downloadDir = downloadDir;
    this.activeDownloads = new Map();
  }

  async ensureDownloadDir() {
    try {
      await fs.ensureDir(this.downloadDir);
    } catch (error) {
      console.error('Failed to create download directory:', error);
      throw new Error('Failed to create download directory: ' + error.message);
    }
  }

  async prepareFileTransfer(filePath) {
    const fileStats = await fs.stat(filePath);
    const fileHash = await this.calculateFileHash(filePath);
    
    return {
      path: filePath,
      name: path.basename(filePath),
      size: fileStats.size,
      hash: fileHash
    };
  }

  async calculateFileHash(filePath) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);
      
      stream.on('error', reject);
      stream.on('data', chunk => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
    });
  }

  async startFileDownload(peerId, fileName, fileSize) {
    try {
      // Ensure the download directory exists first
      await this.ensureDownloadDir();

      // Sanitize the filename to prevent directory traversal
      const safeFileName = path.basename(fileName);
      const downloadPath = path.join(this.downloadDir, safeFileName);

      // If file exists, append a number to make it unique
      let finalPath = downloadPath;
      let counter = 1;
      while (await fs.pathExists(finalPath)) {
        const ext = path.extname(downloadPath);
        const base = path.basename(downloadPath, ext);
        finalPath = path.join(this.downloadDir, `${base} (${counter})${ext}`);
        counter++;
      }

      const downloadInfo = {
        path: finalPath,
        size: fileSize,
        received: 0,
        stream: fs.createWriteStream(finalPath)
      };

      // Set up error handler for the stream
      downloadInfo.stream.on('error', (error) => {
        console.error('Stream error:', error);
        this.cleanupDownload(peerId).catch(console.error);
      });

      this.activeDownloads.set(peerId, downloadInfo);
      return finalPath;
    } catch (error) {
      console.error('Failed to start file download:', error);
      throw new Error('Failed to start file download: ' + error.message);
    }
  }

  async writeChunk(peerId, chunk) {
    const downloadInfo = this.activeDownloads.get(peerId);
    if (!downloadInfo) {
      throw new Error('No active download for peer');
    }

    try {
      await new Promise((resolve, reject) => {
        downloadInfo.stream.write(Buffer.from(chunk), error => {
          if (error) reject(error);
          else resolve();
        });
      });

      downloadInfo.received += chunk.length;
      return {
        progress: (downloadInfo.received / downloadInfo.size) * 100,
        received: downloadInfo.received,
        total: downloadInfo.size
      };
    } catch (error) {
      console.error('Error writing chunk:', error);
      throw error;
    }
  }

  async completeDownload(peerId) {
    const downloadInfo = this.activeDownloads.get(peerId);
    if (!downloadInfo) {
      throw new Error('No active download for peer');
    }

    await new Promise((resolve, reject) => {
      downloadInfo.stream.end(() => {
        resolve();
      });
    });

    this.activeDownloads.delete(peerId);
    return downloadInfo.path;
  }

  async verifyFile(filePath, expectedHash) {
    const actualHash = await this.calculateFileHash(filePath);
    return actualHash === expectedHash;
  }

  async cleanupIncompleteDownloads() {
    for (const [peerId, downloadInfo] of this.activeDownloads.entries()) {
      try {
        await fs.remove(downloadInfo.path);
      } catch (error) {
        console.error(`Failed to cleanup download for peer ${peerId}:`, error);
      }
    }
    this.activeDownloads.clear();
  }

  // Add a new method to cleanup a specific download
  async cleanupDownload(peerId) {
    const downloadInfo = this.activeDownloads.get(peerId);
    if (downloadInfo) {
      try {
        if (downloadInfo.stream) {
          downloadInfo.stream.end();
        }
        if (downloadInfo.path && await fs.pathExists(downloadInfo.path)) {
          await fs.remove(downloadInfo.path);
        }
      } catch (error) {
        console.error(`Failed to cleanup download for peer ${peerId}:`, error);
      } finally {
        this.activeDownloads.delete(peerId);
      }
    }
  }
}

module.exports = FileManager; 