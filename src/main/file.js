const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');

class FileManager {
  constructor(downloadDir) {
    this.downloadDir = downloadDir;
    this.activeDownloads = new Map();
    this.ensureDownloadDir();
  }

  async ensureDownloadDir() {
    await fs.ensureDir(this.downloadDir);
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
    const downloadPath = path.join(this.downloadDir, fileName);
    const downloadInfo = {
      path: downloadPath,
      size: fileSize,
      received: 0,
      stream: fs.createWriteStream(downloadPath)
    };

    this.activeDownloads.set(peerId, downloadInfo);
    return downloadPath;
  }

  async writeChunk(peerId, chunk) {
    const downloadInfo = this.activeDownloads.get(peerId);
    if (!downloadInfo) {
      throw new Error('No active download for peer');
    }

    await new Promise((resolve, reject) => {
      downloadInfo.stream.write(chunk, error => {
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
}

module.exports = FileManager; 