// Comprehensive Reconnection Manager for P2P Chat
class ReconnectionManager {
    constructor(app) {
        this.app = app;
        
        // Reconnection state
        this.reconnectionState = 'idle'; // idle, detecting, reconnecting, connected, failed
        this.reconnectionAttempts = 0;
        this.maxReconnectionAttempts = 5;
        this.reconnectionDelay = 1000; // Start with 1 second
        this.maxReconnectionDelay = 30000; // Max 30 seconds
        
        // Timers
        this.reconnectionTimer = null;
        this.healthCheckTimer = null;
        this.connectionTimeoutTimer = null;
        
        // Connection health
        this.lastHealthCheck = Date.now();
        this.healthCheckInterval = 5000; // Check every 5 seconds
        this.connectionTimeout = 10000; // 10 seconds to establish connection
        
        // Tracking what needs reconnection
        this.needsFirebaseReconnect = false;
        this.needsWebRTCReconnect = false;
        this.lostPeers = new Set();
        
        // Connection snapshots for recovery
        this.connectionSnapshot = null;
        
        // Callbacks
        this.onStateChangeCallback = null;
        
        // Start health monitoring
        this.startHealthMonitoring();
    }
    
    // Start monitoring connection health
    startHealthMonitoring() {
        // Clear existing timer
        if (this.healthCheckTimer) {
            clearInterval(this.healthCheckTimer);
        }
        
        // Check connection health periodically
        this.healthCheckTimer = setInterval(() => {
            this.checkConnectionHealth();
        }, this.healthCheckInterval);
    }
    
    // Check overall connection health
    checkConnectionHealth() {
        if (!this.app.roomId || this.reconnectionState === 'reconnecting') {
            return; // Not in room or already reconnecting
        }
        
        const now = Date.now();
        const healthStatus = this.getHealthStatus();
        
        console.log(`[Reconnect] Health Check:
            Firebase: ${healthStatus.firebase}
            WebRTC Peers: ${healthStatus.webrtcConnected}/${healthStatus.totalPeers}
            State: ${this.reconnectionState}`);
        
        // Detect connection issues
        if (healthStatus.needsReconnection) {
            this.handleConnectionLoss(healthStatus);
        } else if (this.reconnectionState === 'detecting') {
            // Connection recovered during detection
            this.handleConnectionRecovered();
        }
        
        this.lastHealthCheck = now;
    }
    
    // Get current health status
    getHealthStatus() {
        const app = this.app;
        const status = {
            firebase: false,
            firebaseRoom: false,
            webrtcConnected: 0,
            totalPeers: 0,
            needsReconnection: false,
            issues: []
        };
        
        // Check Firebase
        if (app.firebaseHandler) {
            status.firebase = app.firebaseHandler.isConnected;
            status.firebaseRoom = app.firebaseHandler.roomRef !== null;
        }
        
        // Check WebRTC
        if (app.webrtcHandler) {
            status.webrtcConnected = app.webrtcHandler.getConnectedPeersCount();
        }
        
        // Check peers
        status.totalPeers = app.peers.size;
        
        // Determine if reconnection needed
        if (app.roomId) {
            // Should be in a room
            if (!status.firebase && !status.firebaseRoom) {
                status.needsReconnection = true;
                status.issues.push('Firebase disconnected');
            }
            
            if (status.totalPeers > 0 && status.webrtcConnected === 0) {
                status.needsReconnection = true;
                status.issues.push('All WebRTC connections lost');
            }
            
            if (status.totalPeers > status.webrtcConnected + 1) {
                // Some peers disconnected (allow 1 peer tolerance for connection in progress)
                status.issues.push('Some peers disconnected');
            }
        }
        
        return status;
    }
    
    // Handle detected connection loss
    handleConnectionLoss(healthStatus) {
        if (this.reconnectionState !== 'idle') {
            return; // Already handling
        }
        
        console.log('[Reconnect] Connection loss detected:', healthStatus.issues);
        
        this.reconnectionState = 'detecting';
        this.updateState('detecting');
        
        // Take snapshot of current state
        this.takeConnectionSnapshot();
        
        // Determine what needs reconnection
        this.needsFirebaseReconnect = !healthStatus.firebase || !healthStatus.firebaseRoom;
        this.needsWebRTCReconnect = healthStatus.totalPeers > 0 && healthStatus.webrtcConnected === 0;
        
        // Track lost peers
        if (this.needsWebRTCReconnect) {
            this.app.peers.forEach(peerId => {
                const connected = this.app.webrtcHandler?.getConnectedPeerIds().includes(peerId);
                if (!connected) {
                    this.lostPeers.add(peerId);
                }
            });
        }
        
        // Show reconnect button after brief delay (to avoid flashing)
        setTimeout(() => {
            if (this.reconnectionState === 'detecting') {
                this.showReconnectUI();
            }
        }, 2000);
        
        // Start automatic reconnection after 5 seconds
        setTimeout(() => {
            if (this.reconnectionState === 'detecting') {
                this.startReconnection();
            }
        }, 5000);
    }
    
    // Handle connection recovered
    handleConnectionRecovered() {
        console.log('[Reconnect] Connection recovered');
        
        this.reconnectionState = 'connected';
        this.reconnectionAttempts = 0;
        this.reconnectionDelay = 1000;
        this.lostPeers.clear();
        
        this.hideReconnectUI();
        this.updateState('connected');
        
        this.app.messageHandler.displaySystemMessage('✅ Connection stable');
    }
    
    // Take snapshot of connection state
    takeConnectionSnapshot() {
        this.connectionSnapshot = {
            roomId: this.app.savedRoomId,
            nickname: this.app.savedNickname,
            userId: this.app.userId,
            peers: new Set(this.app.peers),
            peerNicknames: new Map(this.app.peerNicknames),
            timestamp: Date.now()
        };
        
        console.log('[Reconnect] Connection snapshot taken:', {
            room: this.connectionSnapshot.roomId,
            peers: this.connectionSnapshot.peers.size
        });
    }
    
    // Start reconnection process
    async startReconnection() {
        if (this.reconnectionState === 'reconnecting') {
            return; // Already reconnecting
        }
        
        this.reconnectionState = 'reconnecting';
        this.reconnectionAttempts++;
        
        console.log(`[Reconnect] Starting reconnection attempt ${this.reconnectionAttempts}/${this.maxReconnectionAttempts}`);
        
        this.updateState('reconnecting');
        this.app.messageHandler.displaySystemMessage(`🔄 Reconnecting... (Attempt ${this.reconnectionAttempts})`);
        
        try {
            // Phase 1: Reconnect Firebase if needed
            if (this.needsFirebaseReconnect) {
                await this.reconnectFirebase();
            }
            
            // Phase 2: Reconnect WebRTC if needed
            if (this.needsWebRTCReconnect) {
                await this.reconnectWebRTC();
            }
            
            // Phase 3: Verify connections
            const verified = await this.verifyReconnection();
            
            if (verified) {
                this.handleReconnectionSuccess();
            } else {
                throw new Error('Connection verification failed');
            }
            
        } catch (error) {
            console.error('[Reconnect] Reconnection failed:', error);
            this.handleReconnectionFailure();
        }
    }
    
    // Reconnect to Firebase
    async reconnectFirebase() {
        console.log('[Reconnect] Reconnecting to Firebase...');
        
        const app = this.app;
        const snapshot = this.connectionSnapshot;
        
        if (!snapshot) {
            throw new Error('No connection snapshot available');
        }
        
        // Clean up existing Firebase connection
        if (app.firebaseHandler) {
            await app.firebaseHandler.leaveRoom();
        }
        
        // Reinitialize Firebase if needed
        if (!app.firebaseHandler.db) {
            const initialized = await app.firebaseHandler.initialize();
            if (!initialized) {
                throw new Error('Firebase initialization failed');
            }
        }
        
        // Wait for Firebase to be online
        await this.waitForFirebaseConnection();
        
        // Rejoin the room
        const joined = await app.firebaseHandler.joinRoom(
            snapshot.roomId,
            app.userId,
            snapshot.nickname
        );
        
        if (!joined) {
            throw new Error('Failed to rejoin Firebase room');
        }
        
        // Re-setup Firebase handlers
        app.setupFirebaseHandlers();
        
        console.log('[Reconnect] Firebase reconnected successfully');
    }
    
    // Wait for Firebase connection
    waitForFirebaseConnection() {
        return new Promise((resolve, reject) => {
            const checkConnection = () => {
                if (this.app.firebaseHandler.isConnected) {
                    resolve();
                    return;
                }
            };
            
            // Check immediately
            checkConnection();
            
            // Set up listener for connection
            const timeout = setTimeout(() => {
                reject(new Error('Firebase connection timeout'));
            }, this.connectionTimeout);
            
            const interval = setInterval(() => {
                if (this.app.firebaseHandler.isConnected) {
                    clearTimeout(timeout);
                    clearInterval(interval);
                    resolve();
                }
            }, 500);
        });
    }
    
    // Reconnect WebRTC connections
    async reconnectWebRTC() {
        console.log('[Reconnect] Reconnecting WebRTC...');
        
        const app = this.app;
        
        // Clean up old WebRTC handler
        if (app.webrtcHandler) {
            app.webrtcHandler.disconnect();
            app.webrtcHandler = null;
        }
        
        // Create new WebRTC handler
        app.webrtcHandler = new WebRTCHandler(app.savedRoomId, app.userId);
        app.setupWebRTCHandlers();
        
        // Reinitialize call handler
        if (app.callHandler) {
            app.callHandler.cleanup();
        }
        app.callHandler = new CallHandler(app.webrtcHandler, app.userId, app.nickname);
        app.callHandler.initializeUI();
        
        // Setup file handler
        app.setupFileHandlers();
        
        // Trigger connections to lost peers
        for (const peerId of this.lostPeers) {
            const nickname = app.peerNicknames.get(peerId);
            if (nickname) {
                console.log(`[Reconnect] Reconnecting to peer: ${nickname} (${peerId})`);
                
                // Check who should initiate
                const shouldInitiate = app.userId < peerId;
                
                if (shouldInitiate) {
                    await app.establishConnectionWithRetry(peerId, nickname, 3);
                } else {
                    // Wait for other peer to initiate
                    console.log(`[Reconnect] Waiting for ${nickname} to initiate connection`);
                }
            }
        }
        
        // Wait for connections to establish
        await this.waitForWebRTCConnections();
        
        console.log('[Reconnect] WebRTC reconnected successfully');
    }
    
    // Wait for WebRTC connections
    waitForWebRTCConnections() {
        return new Promise((resolve) => {
            const startTime = Date.now();
            const checkInterval = 1000;
            const maxWaitTime = 15000; // 15 seconds max
            
            const checkConnections = () => {
                const elapsed = Date.now() - startTime;
                const connectedCount = this.app.webrtcHandler?.getConnectedPeersCount() || 0;
                const targetCount = this.lostPeers.size;
                
                console.log(`[Reconnect] WebRTC connections: ${connectedCount}/${targetCount}`);
                
                if (connectedCount >= targetCount || elapsed > maxWaitTime) {
                    resolve();
                } else {
                    setTimeout(checkConnections, checkInterval);
                }
            };
            
            // Start checking
            setTimeout(checkConnections, checkInterval);
        });
    }
    
    // Verify reconnection success
    async verifyReconnection() {
        console.log('[Reconnect] Verifying reconnection...');
        
        const healthStatus = this.getHealthStatus();
        
        // Check Firebase
        if (this.needsFirebaseReconnect && !healthStatus.firebase) {
            return false;
        }
        
        // Check WebRTC (allow partial success)
        if (this.needsWebRTCReconnect && healthStatus.webrtcConnected === 0 && healthStatus.totalPeers > 0) {
            return false;
        }
        
        return true;
    }
    
    // Handle successful reconnection
    handleReconnectionSuccess() {
        console.log('[Reconnect] Reconnection successful!');
        
        this.reconnectionState = 'connected';
        this.reconnectionAttempts = 0;
        this.reconnectionDelay = 1000;
        this.lostPeers.clear();
        this.needsFirebaseReconnect = false;
        this.needsWebRTCReconnect = false;
        
        this.hideReconnectUI();
        this.updateState('connected');
        
        this.app.messageHandler.displaySystemMessage('✅ Reconnected successfully');
        this.app.updatePeerCount();
    }
    
    // Handle failed reconnection
    handleReconnectionFailure() {
        console.log('[Reconnect] Reconnection attempt failed');
        
        if (this.reconnectionAttempts >= this.maxReconnectionAttempts) {
            // Max attempts reached
            this.reconnectionState = 'failed';
            this.updateState('failed');
            
            this.app.messageHandler.displaySystemMessage('❌ Reconnection failed. Please refresh the page.');
            this.showManualReconnectUI();
            
        } else {
            // Schedule next attempt with exponential backoff
            this.reconnectionDelay = Math.min(this.reconnectionDelay * 2, this.maxReconnectionDelay);
            
            console.log(`[Reconnect] Next attempt in ${this.reconnectionDelay / 1000} seconds`);
            
            this.reconnectionState = 'detecting';
            this.updateState('waiting');
            
            this.app.messageHandler.displaySystemMessage(
                `⏳ Next reconnection attempt in ${this.reconnectionDelay / 1000} seconds...`
            );
            
            this.reconnectionTimer = setTimeout(() => {
                this.startReconnection();
            }, this.reconnectionDelay);
        }
    }
    
    // Manual reconnection triggered by user
    async manualReconnect() {
        console.log('[Reconnect] Manual reconnection triggered');
        
        // Reset attempts
        this.reconnectionAttempts = 0;
        this.reconnectionDelay = 1000;
        
        // Clear any pending timers
        if (this.reconnectionTimer) {
            clearTimeout(this.reconnectionTimer);
            this.reconnectionTimer = null;
        }
        
        // Start reconnection
        await this.startReconnection();
    }
    
    // Show reconnect UI
    showReconnectUI() {
        const reconnectBtn = document.getElementById('reconnectBtn');
        if (reconnectBtn) {
            reconnectBtn.style.display = 'inline-block';
            reconnectBtn.textContent = 'Reconnect';
            reconnectBtn.disabled = false;
        }
    }
    
    // Show manual reconnect UI
    showManualReconnectUI() {
        const reconnectBtn = document.getElementById('reconnectBtn');
        if (reconnectBtn) {
            reconnectBtn.style.display = 'inline-block';
            reconnectBtn.textContent = 'Try Again';
            reconnectBtn.disabled = false;
            reconnectBtn.classList.add('urgent');
        }
    }
    
    // Hide reconnect UI
    hideReconnectUI() {
        const reconnectBtn = document.getElementById('reconnectBtn');
        if (reconnectBtn) {
            reconnectBtn.style.display = 'none';
            reconnectBtn.classList.remove('urgent');
        }
    }
    
    // Update reconnection state
    updateState(state) {
        console.log(`[Reconnect] State: ${state}`);
        
        // Update UI based on state
        const reconnectBtn = document.getElementById('reconnectBtn');
        
        switch (state) {
            case 'detecting':
                if (reconnectBtn) {
                    reconnectBtn.textContent = 'Detecting...';
                    reconnectBtn.disabled = true;
                }
                break;
                
            case 'reconnecting':
                if (reconnectBtn) {
                    reconnectBtn.textContent = 'Reconnecting...';
                    reconnectBtn.disabled = true;
                }
                break;
                
            case 'waiting':
                if (reconnectBtn) {
                    reconnectBtn.textContent = `Retry in ${this.reconnectionDelay / 1000}s`;
                    reconnectBtn.disabled = false;
                }
                break;
                
            case 'connected':
                this.hideReconnectUI();
                break;
                
            case 'failed':
                if (reconnectBtn) {
                    reconnectBtn.textContent = 'Try Again';
                    reconnectBtn.disabled = false;
                }
                break;
        }
        
        if (this.onStateChangeCallback) {
            this.onStateChangeCallback(state);
        }
    }
    
    // Cleanup
    cleanup() {
        if (this.healthCheckTimer) {
            clearInterval(this.healthCheckTimer);
            this.healthCheckTimer = null;
        }
        
        if (this.reconnectionTimer) {
            clearTimeout(this.reconnectionTimer);
            this.reconnectionTimer = null;
        }
        
        if (this.connectionTimeoutTimer) {
            clearTimeout(this.connectionTimeoutTimer);
            this.connectionTimeoutTimer = null;
        }
    }
    
    // Set state change callback
    onStateChange(callback) {
        this.onStateChangeCallback = callback;
    }
}

// Export
window.ReconnectionManager = ReconnectionManager;