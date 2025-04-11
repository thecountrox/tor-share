const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const crypto = require('crypto');

class FileManager {
  constructor(downloadDir) {
    this.downloadDir = downloadDir;
    this.activeDownloads = new Map();
    console.log('[DEBUG] FileManager constructed with:', downloadDir);
  }

  async ensureDownloadDir() {
    try {
      await fs.mkdir(this.downloadDir, { recursive: true });
      console.log('[DEBUG] Download directory ensured:', this.downloadDir);
    } catch (error) {
      console.error('[DEBUG] Failed to create download directory:', error);
      throw error;
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
      const stream = fsSync.createReadStream(filePath);
      
      stream.on('error', reject);
      stream.on('data', chunk => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
    });
  }

  async startFileDownload(peerId, fileName, fileSize) {
    console.log('[DEBUG] Starting file download:', { peerId, fileName, fileSize });
    try {
      await this.ensureDownloadDir();

      const safeFileName = path.basename(fileName);
      const downloadPath = path.join(this.downloadDir, safeFileName);

      let finalPath = downloadPath;
      let counter = 1;
      
      while (true) {
        try {
          await fs.access(finalPath);
          const ext = path.extname(downloadPath);
          const base = path.basename(downloadPath, ext);
          finalPath = path.join(this.downloadDir, `${base} (${counter})${ext}`);
          counter++;
        } catch (error) {
          // File doesn't exist, we can use this path
          break;
        }
      }

      console.log('[DEBUG] Creating write stream for:', finalPath);
      const stream = fsSync.createWriteStream(finalPath);
      
      const downloadInfo = {
        path: finalPath,
        size: fileSize,
        received: 0,
        stream,
        chunks: new Map() // Store chunks that arrive out of order
      };

      stream.on('error', (error) => {
        console.error('[DEBUG] Stream error:', error);
        this.cleanupDownload(peerId).catch(err => {
          console.error('[DEBUG] Cleanup error:', err);
        });
      });

      this.activeDownloads.set(peerId, downloadInfo);
      return finalPath;
    } catch (error) {
      console.error('[DEBUG] Error in startFileDownload:', error);
      throw error;
    }
  }

  async writeChunk(peerId, chunk, chunkIndex) {
    console.log('[DEBUG] Writing chunk:', { peerId, chunkIndex, size: chunk.length });
    const downloadInfo = this.activeDownloads.get(peerId);
    if (!downloadInfo) {
      throw new Error('No active download for peer');
    }

    try {
      await new Promise((resolve, reject) => {
        downloadInfo.stream.write(chunk, error => {
          if (error) reject(error);
          else resolve();
        });
      });

      downloadInfo.received += chunk.length;
      console.log('[DEBUG] Chunk written successfully. Total received:', downloadInfo.received);

      return {
        progress: (downloadInfo.received / downloadInfo.size) * 100,
        received: downloadInfo.received,
        total: downloadInfo.size
      };
    } catch (error) {
      console.error('[DEBUG] Error writing chunk:', error);
      throw error;
    }
  }

  async completeDownload(peerId) {
    console.log('[DEBUG] Completing download for peer:', peerId);
    const downloadInfo = this.activeDownloads.get(peerId);
    if (!downloadInfo) {
      throw new Error('No active download for peer');
    }

    try {
      await new Promise((resolve, reject) => {
        downloadInfo.stream.end(err => {
          if (err) reject(err);
          else resolve();
        });
      });

      const finalPath = downloadInfo.path;
      this.activeDownloads.delete(peerId);
      console.log('[DEBUG] Download completed:', finalPath);
      return finalPath;
    } catch (error) {
      console.error('[DEBUG] Error completing download:', error);
      throw error;
    }
  }

  async verifyFile(filePath, expectedHash) {
    const actualHash = await this.calculateFileHash(filePath);
    return actualHash === expectedHash;
  }

  async cleanupIncompleteDownloads() {
    for (const [peerId, downloadInfo] of this.activeDownloads.entries()) {
      try {
        await fs.unlink(downloadInfo.path);
      } catch (error) {
        console.error(`Failed to cleanup download for peer ${peerId}:`, error);
      }
    }
    this.activeDownloads.clear();
  }

  async cleanupDownload(peerId) {
    console.log('[DEBUG] Cleaning up download for peer:', peerId);
    const downloadInfo = this.activeDownloads.get(peerId);
    if (downloadInfo) {
      try {
        if (downloadInfo.stream) {
          downloadInfo.stream.end();
        }
        if (downloadInfo.path) {
          try {
            await fs.unlink(downloadInfo.path);
            console.log('[DEBUG] Cleaned up incomplete file:', downloadInfo.path);
          } catch (error) {
            console.error('[DEBUG] Error deleting incomplete file:', error);
          }
        }
      } finally {
        this.activeDownloads.delete(peerId);
      }
    }
  }
}

module.exports = FileManager; 