// File Handler for P2P file sharing
class FileHandler {
    constructor() {
        this.CHUNK_SIZE = 16 * 1024; // 16KB chunks for safety
        this.MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB max file size
        this.pendingFiles = new Map(); // Map of fileId -> file metadata and chunks
        this.onFileReceivedCallback = null;
        this.onProgressCallback = null;
        this.sendingQueue = [];
        this.isSending = false;
    }

    // Generate unique file ID
    generateFileId() {
        return `file-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    // Prepare file for sending
    async prepareFile(file) {
        if (file.size > this.MAX_FILE_SIZE) {
            throw new Error(`File too large. Maximum size is ${this.MAX_FILE_SIZE / 1024 / 1024}MB`);
        }

        const fileId = this.generateFileId();
        const chunks = await this.chunkFile(file);
        
        const fileMetadata = {
            id: fileId,
            name: file.name,
            size: file.size,
            type: file.type,
            totalChunks: chunks.length,
            timestamp: Date.now()
        };

        return { metadata: fileMetadata, chunks };
    }

    // Chunk file into smaller pieces
    async chunkFile(file) {
        const chunks = [];
        let offset = 0;

        while (offset < file.size) {
            const chunk = file.slice(offset, offset + this.CHUNK_SIZE);
            const arrayBuffer = await chunk.arrayBuffer();
            chunks.push(arrayBuffer);
            offset += this.CHUNK_SIZE;
        }

        return chunks;
    }

    // Send file through WebRTC data channel
    async sendFile(file, webrtcHandler, senderNickname) {
        try {
            console.log(`Starting file transfer: ${file.name} (${this.formatFileSize(file.size)})`);
            
            const { metadata, chunks } = await this.prepareFile(file);
            
            // Add sender info to metadata
            metadata.senderNickname = senderNickname;
            
            console.log(`File chunked into ${chunks.length} chunks of ${this.CHUNK_SIZE} bytes`);
            
            // Send file metadata first
            const metadataMessage = {
                type: 'file-metadata',
                metadata: metadata,
                senderId: metadata.senderNickname
            };

            if (!webrtcHandler.sendMessage(metadataMessage)) {
                throw new Error('Failed to send file metadata');
            }
            
            console.log('File metadata sent successfully');

            // Send chunks one by one with proper buffering
            for (let i = 0; i < chunks.length; i++) {
                // Convert ArrayBuffer to base64 for reliable transmission
                const base64Data = this.arrayBufferToBase64(chunks[i]);
                
                const chunkMessage = {
                    type: 'file-chunk',
                    fileId: metadata.id,
                    chunkIndex: i,
                    data: base64Data, // Send as base64 string
                    totalChunks: chunks.length
                };

                // Check message size
                const messageSize = JSON.stringify(chunkMessage).length;
                if (messageSize > 256 * 1024) { // 256KB limit for safety
                    console.error(`Chunk ${i} too large: ${messageSize} bytes`);
                    throw new Error('File chunk too large. Try a smaller file.');
                }

                if (!webrtcHandler.sendMessage(chunkMessage)) {
                    throw new Error(`Failed to send chunk ${i + 1}/${chunks.length}`);
                }

                // Report progress
                if (this.onProgressCallback) {
                    this.onProgressCallback(metadata.id, (i + 1) / chunks.length, 'sending');
                }

                // Delay between chunks to avoid overwhelming the channel
                await this.delay(20);
            }

            // Send completion message
            const completeMessage = {
                type: 'file-complete',
                fileId: metadata.id
            };
            webrtcHandler.sendMessage(completeMessage);

            return metadata;
        } catch (error) {
            console.error('Error sending file:', error);
            throw error;
        }
    }

    // Handle incoming file metadata
    handleFileMetadata(metadata) {
        console.log('Receiving file:', metadata.name, `(${this.formatFileSize(metadata.size)})`);
        
        this.pendingFiles.set(metadata.id, {
            metadata: metadata,
            chunks: new Array(metadata.totalChunks),
            receivedChunks: 0
        });

        // Notify UI about incoming file
        if (this.onProgressCallback) {
            this.onProgressCallback(metadata.id, 0, 'receiving', metadata);
        }
    }

    // Handle incoming file chunk
    handleFileChunk(fileId, chunkIndex, data) {
        const pendingFile = this.pendingFiles.get(fileId);
        if (!pendingFile) {
            console.error('Received chunk for unknown file:', fileId);
            return;
        }

        // Convert base64 back to Uint8Array
        const binaryData = this.base64ToUint8Array(data);
        
        // Store chunk
        pendingFile.chunks[chunkIndex] = binaryData;
        pendingFile.receivedChunks++;

        // Report progress
        const progress = pendingFile.receivedChunks / pendingFile.metadata.totalChunks;
        if (this.onProgressCallback) {
            this.onProgressCallback(fileId, progress, 'receiving', pendingFile.metadata);
        }

        console.log(`File ${fileId}: ${pendingFile.receivedChunks}/${pendingFile.metadata.totalChunks} chunks received`);
    }

    // Handle file transfer completion
    handleFileComplete(fileId) {
        const pendingFile = this.pendingFiles.get(fileId);
        if (!pendingFile) {
            console.error('Received completion for unknown file:', fileId);
            return;
        }

        // Combine chunks into final file
        const totalLength = pendingFile.chunks.reduce((acc, chunk) => acc + chunk.length, 0);
        const fileData = new Uint8Array(totalLength);
        let offset = 0;

        for (const chunk of pendingFile.chunks) {
            fileData.set(chunk, offset);
            offset += chunk.length;
        }

        // Create blob and download link
        const blob = new Blob([fileData], { type: pendingFile.metadata.type });
        const url = URL.createObjectURL(blob);

        // Notify callback
        if (this.onFileReceivedCallback) {
            this.onFileReceivedCallback({
                ...pendingFile.metadata,
                url: url,
                blob: blob
            });
        }

        // Clean up
        this.pendingFiles.delete(fileId);
        console.log('File received successfully:', pendingFile.metadata.name);
    }

    // Format file size for display
    formatFileSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }

    // Utility delay function
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    
    // Convert ArrayBuffer to base64
    arrayBufferToBase64(buffer) {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    }
    
    // Convert base64 to Uint8Array
    base64ToUint8Array(base64) {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes;
    }

    // Check if file type is an image
    isImage(type) {
        return type && type.startsWith('image/');
    }

    // Set callbacks
    onFileReceived(callback) {
        this.onFileReceivedCallback = callback;
    }

    onProgress(callback) {
        this.onProgressCallback = callback;
    }
}

// Create global instance
window.fileHandler = new FileHandler();