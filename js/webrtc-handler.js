// WebRTC Handler for P2P connections
class WebRTCHandler {
    constructor(roomId, userId) {
        this.roomId = roomId;
        this.userId = userId;
        this.peers = new Map(); // Map of peerId -> RTCPeerConnection
        this.dataChannels = new Map(); // Map of peerId -> RTCDataChannel
        this.pendingCandidates = new Map(); // Map of peerId -> ICE candidates queue
        this.initiatorMap = new Map(); // Map of peerId -> boolean (true if we initiated)
        this.connectedPeers = new Set(); // Track peers we've already shown connection message for
        this.onMessageCallback = null;
        this.onPeerConnectedCallback = null;
        this.onPeerDisconnectedCallback = null;
    }

    // Initialize WebRTC for a new peer
    async createPeerConnection(peerId, isInitiator) {
        console.log(`Creating peer connection with ${peerId}, initiator: ${isInitiator}`);
        
        // Clean up any existing connection first
        if (this.peers.has(peerId)) {
            console.log(`Cleaning up existing connection for ${peerId}`);
            this.handlePeerDisconnected(peerId);
        }
        
        // Track who initiated the connection
        this.initiatorMap.set(peerId, isInitiator);
        
        const pc = new RTCPeerConnection({
            iceServers: CONFIG.ICE_SERVERS
        });

        this.peers.set(peerId, pc);

        // Handle ICE candidates
        pc.onicecandidate = (event) => {
            if (event.candidate) {
                this.sendSignal(peerId, {
                    type: 'ice-candidate',
                    candidate: event.candidate.toJSON()
                });
            }
        };

        // Handle connection state changes
        pc.onconnectionstatechange = () => {
            if (pc.connectionState === 'connected') {
                console.log(`✅ Connected to ${peerId}`);
            } else if (pc.connectionState === 'failed') {
                console.error(`❌ Connection failed with ${peerId}`);
                this.handlePeerDisconnected(peerId);
            } else if (pc.connectionState === 'disconnected') {
                this.handlePeerDisconnected(peerId);
            }
        };

        // Add ICE connection state monitoring
        pc.oniceconnectionstatechange = () => {
            if (pc.iceConnectionState === 'failed') {
                console.error('❌ ICE connection failed');
                this.handlePeerDisconnected(peerId);
            }
        };

        // Setup data channel handler for receivers BEFORE any signaling
        if (!isInitiator) {
            pc.ondatachannel = (event) => {
                this.setupDataChannel(event.channel, peerId);
            };
        }
        
        // Create data channel if initiator
        if (isInitiator) {
            const dataChannel = pc.createDataChannel('messages', {
                ordered: true,
                maxRetransmits: 3  // Use only maxRetransmits, not both
            });
            this.setupDataChannel(dataChannel, peerId);
            
            // Create offer after data channel is set up
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            this.sendSignal(peerId, {
                type: 'offer',
                offer: {
                    type: offer.type,
                    sdp: offer.sdp
                }
            });
        }

        return pc;
    }

    // Setup data channel event handlers
    setupDataChannel(dataChannel, peerId) {
        dataChannel.onopen = () => {
            console.log(`✅ WebRTC channel open with ${peerId}`);
            this.dataChannels.set(peerId, dataChannel);
            this.handlePeerConnected(peerId);
            
            // Send a test message to verify the channel
            setTimeout(() => {
                try {
                    dataChannel.send(JSON.stringify({
                        type: 'connection_test',
                        from: this.userId,
                        timestamp: Date.now()
                    }));
                } catch (error) {
                    // Silent fail for test message
                }
            }, 500);
        };

        dataChannel.onclose = () => {
            this.dataChannels.delete(peerId);
            this.handlePeerDisconnected(peerId);
        };

        dataChannel.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                
                // Handle connection test messages
                if (message.type === 'connection_test') {
                    return;
                }
                
                if (this.onMessageCallback) {
                    this.onMessageCallback(message, peerId);
                }
            } catch (error) {
                console.error('Error parsing message:', error);
            }
        };

        dataChannel.onerror = (error) => {
            console.error(`Data channel error with ${peerId}:`, error);
        };

        // Store data channel immediately if it's already open
        if (dataChannel.readyState === 'open') {
            this.dataChannels.set(peerId, dataChannel);
            this.handlePeerConnected(peerId);
            
            // Send test message immediately
            try {
                dataChannel.send(JSON.stringify({
                    type: 'connection_test',
                    from: this.userId,
                    timestamp: Date.now()
                }));
            } catch (error) {
                // Silent fail
            }
        }
    }

    // Handle incoming signaling messages
    async handleSignal(peerId, signal) {
        try {
            // Handle data if signal is wrapped
            const signalData = signal.data || signal;
            
            if (signalData.type === 'offer') {
                // Create peer connection if doesn't exist
                if (!this.peers.has(peerId)) {
                    await this.createPeerConnection(peerId, false);
                }
                
                const pc = this.peers.get(peerId);
                if (pc && signalData.offer) {
                    await pc.setRemoteDescription(new RTCSessionDescription(signalData.offer));
                    
                    // Create and send answer
                    const answer = await pc.createAnswer();
                    await pc.setLocalDescription(answer);
                    
                    this.sendSignal(peerId, {
                        type: 'answer',
                        answer: {
                            type: answer.type,
                            sdp: answer.sdp
                        }
                    });
                    
                    // Process any pending ICE candidates
                    await this.processPendingCandidates(peerId);
                }
                
            } else if (signalData.type === 'answer') {
                const pc = this.peers.get(peerId);
                
                if (!pc) {
                    console.error(`No peer connection found for ${peerId}`);
                    return;
                }
                
                if (!signalData.answer || !signalData.answer.sdp) {
                    console.error('Invalid answer data');
                    return;
                }
                
                // Check current signaling state
                if (pc.signalingState === 'have-local-offer') {
                    await pc.setRemoteDescription(new RTCSessionDescription(signalData.answer));
                    
                    // Process any pending ICE candidates
                    await this.processPendingCandidates(peerId);
                } else {
                    console.warn(`Cannot set answer in state: ${pc.signalingState}`);
                }
                
            } else if (signalData.type === 'ice-candidate') {
                // Create peer connection if doesn't exist (in case ICE arrives first)
                if (!this.peers.has(peerId)) {
                    await this.createPeerConnection(peerId, false);
                }
                
                const pc = this.peers.get(peerId);
                if (pc && signalData.candidate && signalData.candidate.candidate) {
                    // Check if remote description is set
                    if (pc.remoteDescription) {
                        try {
                            await pc.addIceCandidate(new RTCIceCandidate(signalData.candidate));
                        } catch (error) {
                            // Silent fail for ICE candidates
                        }
                    } else {
                        // Queue the candidate for later
                        if (!this.pendingCandidates.has(peerId)) {
                            this.pendingCandidates.set(peerId, []);
                        }
                        this.pendingCandidates.get(peerId).push(signalData.candidate);
                    }
                }
            }
        } catch (error) {
            console.error(`Error handling signal from ${peerId}:`, error);
        }
    }

    // Process pending ICE candidates
    async processPendingCandidates(peerId) {
        const candidates = this.pendingCandidates.get(peerId);
        if (candidates && candidates.length > 0) {
            const pc = this.peers.get(peerId);
            if (pc && pc.remoteDescription) {
                for (const candidate of candidates) {
                    try {
                        await pc.addIceCandidate(new RTCIceCandidate(candidate));
                    } catch (error) {
                        // Silent fail
                    }
                }
                this.pendingCandidates.delete(peerId);
            }
        }
    }

    // Send message via WebRTC data channels
    sendMessage(message) {
        const messageStr = JSON.stringify(message);
        let sent = false;

        this.dataChannels.forEach((channel, peerId) => {
            if (channel.readyState === 'open') {
                try {
                    // Check buffer amount before sending
                    if (channel.bufferedAmount > 16 * 1024 * 1024) { // 16MB buffer limit
                        console.warn('Data channel buffer full, waiting...');
                        return false;
                    }
                    
                    channel.send(messageStr);
                    sent = true;
                    
                    // Only log for non-chunk messages to reduce console spam
                    if (message.type !== 'file-chunk') {
                        console.log(`Message sent via WebRTC to ${peerId}`);
                    }
                } catch (error) {
                    console.error('Failed to send message:', error);
                    // Try to recover the channel
                    this.dataChannels.delete(peerId);
                }
            }
        });

        return sent;
    }

    // Send signaling message (to be implemented with Firebase)
    sendSignal(peerId, signal) {
        // This will be connected to Firebase signaling
        if (window.firebaseHandler) {
            window.firebaseHandler.sendSignal(this.roomId, this.userId, peerId, signal);
        }
    }

    // Handle peer connected
    handlePeerConnected(peerId) {
        // Only show connection message once per peer
        if (!this.connectedPeers.has(peerId)) {
            this.connectedPeers.add(peerId);
            if (this.onPeerConnectedCallback) {
                this.onPeerConnectedCallback(peerId);
            }
        }
    }

    // Handle peer disconnected
    handlePeerDisconnected(peerId) {
        console.log(`Peer disconnected: ${peerId}`);
        
        // Clean up peer connection
        const pc = this.peers.get(peerId);
        if (pc) {
            pc.close();
            this.peers.delete(peerId);
        }
        
        // Clean up data channel and initiator map
        this.dataChannels.delete(peerId);
        this.initiatorMap.delete(peerId);
        this.connectedPeers.delete(peerId);
        
        if (this.onPeerDisconnectedCallback) {
            this.onPeerDisconnectedCallback(peerId);
        }
    }

    // Get connected peers count
    getConnectedPeersCount() {
        let count = 0;
        this.dataChannels.forEach((channel) => {
            if (channel.readyState === 'open') {
                count++;
            }
        });
        return count;
    }

    // Check if WebRTC is connected to any peer
    isConnected() {
        return this.getConnectedPeersCount() > 0;
    }

    // Clean up all connections
    disconnect() {
        this.peers.forEach((pc, peerId) => {
            pc.close();
        });
        this.peers.clear();
        this.dataChannels.clear();
    }

    // Set callbacks
    onMessage(callback) {
        this.onMessageCallback = callback;
    }

    onPeerConnected(callback) {
        this.onPeerConnectedCallback = callback;
    }

    onPeerDisconnected(callback) {
        this.onPeerDisconnectedCallback = callback;
    }
}