// Main Application Logic
class P2PChatApp {
    constructor() {
        this.roomId = null;
        this.userId = this.generateUserId();
        this.nickname = null;
        this.webrtcHandler = null;
        this.firebaseHandler = window.firebaseHandler;
        this.messageHandler = new MessageHandler();
        this.fileHandler = window.fileHandler;
        this.callHandler = null; // Will be initialized after joining room
        this.groupCallHandler = null; // Will be initialized after joining room
        // No automatic reconnection - manual only
        this.peers = new Set();
        this.peerNicknames = new Map(); // Map of peerId -> nickname
        this.connectionState = CONFIG.CONNECTION_STATE.DISCONNECTED;
        this.savedRoomId = null; // Store for reconnection
        this.savedNickname = null; // Store for reconnection
        
        // Page visibility handling
        this.isPageVisible = true;
        this.hiddenTimestamp = null;
        this.disconnectTimer = null;
        this.wasConnectedBeforeHidden = false;
        this.typingTimer = null; // Add typing timer as class property

        this.init();
    }

    // Initialize the application
    init() {
        console.log('[App] Initializing P2P Chat Application...');
        console.log('[App] User ID:', this.userId);
        console.log('[App] Firebase Handler:', this.firebaseHandler ? 'Found' : 'Missing');
        
        this.setupEventListeners();
        this.setupMessageHandlers();
        
        // Initialize Firebase when ready
        if (this.firebaseHandler) {
            console.log('[App] Initializing Firebase...');
            this.firebaseHandler.initialize()
                .then(result => {
                    console.log('[App] Firebase initialization result:', result);
                })
                .catch(err => {
                    console.error('[App] Firebase initialization failed:', err);
                    this.updateConnectionStatus(CONFIG.CONNECTION_STATE.DISCONNECTED);
                });
        } else {
            console.error('[App] Firebase Handler not found! Check if firebase-handler.js is loaded properly.');
        }
    }

    // Generate unique user ID
    generateUserId() {
        return 'user-' + Math.random().toString(36).substr(2, 9);
    }

    // Setup UI event listeners
    setupEventListeners() {
        // Setup page visibility handling
        this.setupPageVisibilityHandling();
        
        // Join room button
        const joinBtn = document.getElementById('joinBtn');
        const roomInput = document.getElementById('roomInput');
        const nicknameInput = document.getElementById('nicknameInput');
        
        // Load saved nickname from localStorage
        const savedNickname = localStorage.getItem('chatNickname');
        if (savedNickname) {
            nicknameInput.value = savedNickname;
        }
        
        joinBtn.addEventListener('click', () => this.joinRoom());
        roomInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                // Move to nickname input if room ID is filled
                if (roomInput.value.trim()) {
                    nicknameInput.focus();
                }
            }
        });
        nicknameInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.joinRoom();
            }
        });

        // Message input
        const messageInput = document.getElementById('messageInput');
        const sendButton = document.getElementById('sendButton');
        
        messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });
        
        sendButton.addEventListener('click', () => this.sendMessage());
        
        // File sharing
        const fileButton = document.getElementById('fileButton');
        const fileInput = document.getElementById('fileInput');
        
        fileButton.addEventListener('click', () => {
            // Notify WebRTC handler that file selection is starting
            if (this.webrtcHandler) {
                this.webrtcHandler.setFileSelectionActive(true);
                console.log('[App] File selection started, extended disconnect timeout active');
            }
            fileInput.click();
        });
        
        fileInput.addEventListener('change', (e) => {
            // File selection completed
            if (this.webrtcHandler) {
                this.webrtcHandler.setFileSelectionActive(false);
                console.log('[App] File selection completed');
            }
            this.handleFileSelect(e.target.files);
            fileInput.value = ''; // Reset input
        });
        
        // Also handle if user cancels file selection
        fileInput.addEventListener('cancel', () => {
            if (this.webrtcHandler) {
                this.webrtcHandler.setFileSelectionActive(false);
                console.log('[App] File selection cancelled');
            }
        });
        
        // Handle focus events to detect when file dialog is closed
        window.addEventListener('focus', () => {
            // Small delay to ensure file input change event fires first if a file was selected
            setTimeout(() => {
                if (this.webrtcHandler && this.webrtcHandler.fileSelectionActive) {
                    this.webrtcHandler.setFileSelectionActive(false);
                    console.log('[App] File dialog closed (window refocused)');
                }
            }, 100);
        });

        // Reconnect button - simple manual reconnection
        const reconnectBtn = document.getElementById('reconnectBtn');
        if (reconnectBtn) {
            reconnectBtn.addEventListener('click', () => {
                console.log('[App] Manual reconnect triggered');
                this.manualReconnect();
            });
        }

        // Close tab button
        const closeTabBtn = document.getElementById('closeTabBtn');
        if (closeTabBtn) {
            closeTabBtn.addEventListener('click', () => {
                console.log('[App] Close tab button clicked');
                // Try to close the window/tab
                window.close();

                // If window.close() doesn't work (likely for user-opened tabs),
                // show a message
                setTimeout(() => {
                    if (!window.closed) {
                        this.messageHandler.displaySystemMessage('⚠️ Cannot close this tab automatically. Please close it manually.');
                    }
                }, 100);
            });
        }
        
        // Typing indicator
        messageInput.addEventListener('input', () => {
            if (this.roomId) {
                // Send typing indicator via WebRTC if connected, otherwise Firebase
                const typingMessage = {
                    type: 'typing',
                    userId: this.userId,
                    nickname: this.nickname,
                    isTyping: true,
                    timestamp: Date.now()
                };
                
                if (this.webrtcHandler && this.webrtcHandler.isConnected()) {
                    this.webrtcHandler.sendMessage(typingMessage);
                } else if (this.firebaseHandler) {
                    this.firebaseHandler.sendTypingIndicator(true);
                }
                
                clearTimeout(this.typingTimer);
                this.typingTimer = setTimeout(() => {
                    const stopTypingMessage = {
                        type: 'typing',
                        userId: this.userId,
                        nickname: this.nickname,
                        isTyping: false,
                        timestamp: Date.now()
                    };
                    
                    if (this.webrtcHandler && this.webrtcHandler.isConnected()) {
                        this.webrtcHandler.sendMessage(stopTypingMessage);
                    } else if (this.firebaseHandler) {
                        this.firebaseHandler.sendTypingIndicator(false);
                    }
                }, CONFIG.TYPING_TIMEOUT);
            }
        });
    }

    // Setup message handlers
    setupMessageHandlers() {
        // Handle received messages
        this.messageHandler.onMessage((message, source) => {
            this.messageHandler.displayMessage(message, false);
        });
    }

    // Join a room
    async joinRoom() {
        const roomInput = document.getElementById('roomInput');
        const nicknameInput = document.getElementById('nicknameInput');
        const roomId = roomInput.value.trim().toUpperCase();
        const nickname = nicknameInput.value.trim() || 'Anonymous';
        
        if (!roomId || roomId.length < 4) {
            alert('Please enter a valid room ID (at least 4 characters)');
            return;
        }

        this.roomId = roomId;
        this.nickname = nickname;
        
        // Save for potential reconnection
        this.savedRoomId = roomId;
        this.savedNickname = nickname;
        
        // Save nickname to localStorage
        localStorage.setItem('chatNickname', nickname);
        
        // Hide modal, show chat
        document.getElementById('roomModal').style.display = 'none';
        document.getElementById('chatApp').style.display = 'flex';
        
        // Update room display (show as private for security)
        document.getElementById('roomDisplay').textContent = 'Private Room';
        
        // Enable input and file button
        document.getElementById('messageInput').disabled = false;
        document.getElementById('sendButton').disabled = false;
        document.getElementById('fileButton').disabled = false;
        
        // Initialize WebRTC
        this.webrtcHandler = new WebRTCHandler(roomId, this.userId);
        this.setupWebRTCHandlers();
        
        // Initialize Call Handler
        this.callHandler = new CallHandler(this.webrtcHandler, this.userId, this.nickname);
        this.callHandler.initializeUI();

        // Initialize Group Call Handler
        this.groupCallHandler = new GroupCallHandler(this.webrtcHandler, this.userId, this.nickname);
        this.groupCallHandler.initializeUI();
        
        // Setup file handler
        this.setupFileHandlers();
        
        // Join Firebase room with nickname
        if (this.firebaseHandler) {
            console.log('[App] Joining Firebase room:', roomId);
            const joinResult = await this.firebaseHandler.joinRoom(roomId, this.userId, this.nickname);
            console.log('[App] Firebase room join result:', joinResult);
            
            if (joinResult) {
                console.log('[App] Setting up Firebase handlers...');
                this.setupFirebaseHandlers();
            } else {
                console.error('[App] Failed to join Firebase room!');
                this.messageHandler.displaySystemMessage('⚠️ Failed to connect to Firebase. Running in offline mode.');
            }
        } else {
            console.error('[App] Firebase handler not available!');
        }
        
        // Display system message with loading indicator
        this.messageHandler.displaySystemMessage(`Joined private room`);
        this.messageHandler.displaySystemMessage(`⏳ Waiting for P2P connection to be established...`);
        
        // No automatic reconnection - manual only
        console.log('[App] Manual reconnection mode enabled');
        
        // Update connection status
        this.updateConnectionStatus(CONFIG.CONNECTION_STATE.CONNECTING);
    }

    // Setup WebRTC handlers
    setupWebRTCHandlers() {
        // Handle WebRTC messages
        this.webrtcHandler.onMessage((message, peerId) => {
            // Check if it's a call or media message
            if (message.type && (message.type.startsWith('call-') || message.type.startsWith('media-'))) {
                if (this.callHandler) {
                    this.callHandler.handleMessage(message);
                }
            } else if (message.type && message.type.startsWith('group-call-')) {
                if (this.groupCallHandler) {
                    this.groupCallHandler.handleMessage(message);
                }
            } else if (message.type === 'typing') {
                console.log('Received typing message:', message);
                // Don't show typing indicator for own messages
                if (message.userId !== this.userId) {
                    this.messageHandler.handleTyping(message.userId, message.nickname, message.isTyping);
                }
            } else if (message.type === 'file-metadata') {
                this.fileHandler.handleFileMetadata(message.metadata);
            } else if (message.type === 'file-chunk') {
                this.fileHandler.handleFileChunk(message.fileId, message.chunkIndex, message.data);
            } else if (message.type === 'file-complete') {
                this.fileHandler.handleFileComplete(message.fileId);
            } else if (this.messageHandler.receiveMessage(message, 'webrtc')) {
                // Regular message was new (not duplicate)
                this.updateConnectionStatus(CONFIG.CONNECTION_STATE.CONNECTED);
            }
        });

        // Handle peer connected
        this.webrtcHandler.onPeerConnected((peerId) => {
            // Don't add to peers here - already added in onPeerJoined
            this.updatePeerCount();
            const nickname = this.peerNicknames.get(peerId) || 'Peer';
            this.messageHandler.displaySystemMessage(`✅ P2P connection established with ${nickname}`);
            this.updateConnectionStatus(CONFIG.CONNECTION_STATE.CONNECTED);
            
            // Enable file button and call buttons when P2P is connected
            document.getElementById('fileButton').disabled = false;
            if (this.callHandler) {
                this.callHandler.enableCallButtons();
            }
            if (this.groupCallHandler) {
                this.groupCallHandler.enableCallButton();
            }
        });

        // Handle peer disconnected
        this.webrtcHandler.onPeerDisconnected((peerId) => {
            // Don't show any message here - it will be shown in onPeerLeft
            // Update connection status based on remaining connections
            const connectedCount = this.webrtcHandler.getConnectedPeersCount();
            
            if (connectedCount === 0) {
                // No WebRTC connections left
                if (this.peers.size > 0) {
                    // We still have peers in the room but lost WebRTC connections
                    console.log('[App] Lost all WebRTC connections but peers still in room');
                    this.updateConnectionStatus(CONFIG.CONNECTION_STATE.DISCONNECTED);
                    
                    // Show disconnection message
                    this.messageHandler.displaySystemMessage('⚠️ Lost P2P connection. Click Reconnect to try again.');
                } else {
                    // No peers at all - alone in room
                    this.updateConnectionStatus(CONFIG.CONNECTION_STATE.DISCONNECTED);
                }
            } else {
                // Still have some connections
                this.updateConnectionStatus(CONFIG.CONNECTION_STATE.CONNECTED);
            }
            
            // Update peer count
            this.updatePeerCount();
        });
    }

    // Setup Firebase handlers
    setupFirebaseHandlers() {
        // Handle Firebase connection state changes
        this.firebaseHandler.onConnectionState((connected) => {
            console.log(`[App] Firebase connection: ${connected ? 'ONLINE' : 'OFFLINE'}`);
            if (!connected) {
                this.messageHandler.displaySystemMessage('⚠️ Firebase connection lost. Attempting to reconnect...');
            } else if (this.roomId) {
                this.messageHandler.displaySystemMessage('✅ Firebase connection restored');
            }
            // Update peer count when Firebase state changes
            this.updatePeerCount();
        });
        
        // Handle Firebase messages
        this.firebaseHandler.onMessage((message, senderId) => {
            if (this.messageHandler.receiveMessage(message, 'firebase')) {
                // Message was new (not duplicate)
            }
        });
        
        // Handle typing indicators
        this.firebaseHandler.onTyping((typingUsers) => {
            // Clear all typing indicators first
            this.messageHandler.clearAllTyping();
            
            // Show typing for each user
            typingUsers.forEach(user => {
                this.messageHandler.handleTyping(user.userId, user.nickname, true);
            });
        });

        // Handle peer joined
        this.firebaseHandler.onPeerJoined(async (peerId, nickname, isExistingUser = false) => {
            console.log(`[App] Peer joined: ${peerId} (${nickname}), existing: ${isExistingUser}`);
            // Check if peer already exists to avoid duplicates
            const isNewPeer = !this.peers.has(peerId);
            
            // If peer exists but reconnecting, clean up old connection first
            if (!isNewPeer && this.webrtcHandler) {
                console.log(`[App] Cleaning up old connection for ${peerId}`);
                // Clean up any existing connection
                this.webrtcHandler.handlePeerDisconnected(peerId);
            }
            
            // Add peer to set
            this.peers.add(peerId);
            this.peerNicknames.set(peerId, nickname);
            
            // Show system message only for truly new joins (not existing users)
            if (!isExistingUser) {
                if (isNewPeer) {
                    this.messageHandler.displaySystemMessage(`${nickname} joined the room`);
                } else {
                    this.messageHandler.displaySystemMessage(`${nickname} reconnected`);
                }
            }
            
            // Check if we should initiate WebRTC connection
            const users = await this.firebaseHandler.getRoomUsers();
            console.log(`[App] Room has ${users.length} users`);
            
            if (users.length <= CONFIG.MAX_PEERS) {
                // Check if already connected to this peer
                const connectedPeers = this.webrtcHandler ? this.webrtcHandler.getConnectedPeerIds() : [];
                const isAlreadyConnected = connectedPeers.includes(peerId);
                
                if (isAlreadyConnected) {
                    console.log(`[App] Already connected to ${nickname} (${peerId})`);
                } else {
                    // Important: Only ONE peer should initiate to avoid duplicate connections
                    // Use consistent rule: peer with lexicographically SMALLER ID initiates
                    const shouldInitiate = this.userId < peerId;
                    
                    if (shouldInitiate) {
                        console.log(`[App] Will initiate WebRTC connection to ${nickname} (${peerId})`);
                        
                        // Small delay for existing users to avoid connection storms
                        const delay = isExistingUser ? Math.random() * 1000 : 0;
                        setTimeout(() => {
                            // Try to establish connection with retry logic
                            this.establishConnectionWithRetry(peerId, nickname, 3);
                        }, delay);
                    } else {
                        console.log(`[App] Waiting for ${nickname} (${peerId}) to initiate connection`);
                    }
                }
            } else {
                console.warn(`[App] Room full (${users.length} users), not connecting to ${nickname}`);
            }
            this.updatePeerCount();
        });

        // Handle peer left
        this.firebaseHandler.onPeerLeft((peerId, nickname) => {
            // Only show message if peer was actually in our set
            if (this.peers.has(peerId)) {
                const peerNick = nickname || this.peerNicknames.get(peerId) || 'Peer';
                this.messageHandler.displaySystemMessage(`${peerNick} left the room`);
            }
            
            this.peers.delete(peerId);
            this.peerNicknames.delete(peerId);
            
            this.updatePeerCount();
            this.webrtcHandler.handlePeerDisconnected(peerId);
        });

        // Handle WebRTC signaling
        this.firebaseHandler.onSignal((fromPeer, signal) => {
            this.webrtcHandler.handleSignal(fromPeer, signal);
        });
    }

    // Send message
    async sendMessage() {
        const messageInput = document.getElementById('messageInput');
        const text = messageInput.value.trim();
        
        if (!text) return;
        
        // Send through dual delivery system with nickname
        const message = await this.messageHandler.sendMessage(
            text,
            this.webrtcHandler,
            this.firebaseHandler,
            this.nickname
        );
        
        if (message) {
            // Display sent message
            this.messageHandler.displayMessage(message, true);
            
            // Clear input
            messageInput.value = '';
            
            // Clear typing indicator
            clearTimeout(this.typingTimer);
            const stopTypingMessage = {
                type: 'typing',
                userId: this.userId,
                nickname: this.nickname,
                isTyping: false,
                timestamp: Date.now()
            };
            
            if (this.webrtcHandler && this.webrtcHandler.isConnected()) {
                this.webrtcHandler.sendMessage(stopTypingMessage);
            } else if (this.firebaseHandler) {
                this.firebaseHandler.sendTypingIndicator(false);
            }
        } else {
            alert('Failed to send message. Please check your connection.');
        }
    }

    // Simple manual reconnect to the same room
    async manualReconnect() {
        if (!this.savedRoomId || !this.savedNickname) {
            console.error('[App] No saved room data for reconnection');
            this.messageHandler.displaySystemMessage('❌ No room to reconnect to');
            return;
        }
        
        console.log(`[App] Manual reconnect to room ${this.savedRoomId}...`);
        const reconnectBtn = document.getElementById('reconnectBtn');
        if (reconnectBtn) {
            reconnectBtn.textContent = 'Reconnecting...';
            reconnectBtn.disabled = true;
        }
        
        try {
            this.messageHandler.displaySystemMessage('🔄 Reconnecting...');
            
            // Step 1: Clean up everything for a fresh start
            console.log('[App] Step 1: Cleaning up old connections');
            
            // Clean up WebRTC
            if (this.webrtcHandler) {
                this.webrtcHandler.disconnect();
                this.webrtcHandler = null;
            }
            
            // Clean up Firebase
            if (this.firebaseHandler && this.firebaseHandler.roomRef) {
                await this.firebaseHandler.leaveRoom();
            }
            
            // Clean up call handler
            if (this.callHandler) {
                this.callHandler.cleanup();
                this.callHandler = null;
            }

            // Clean up group call handler
            if (this.groupCallHandler) {
                this.groupCallHandler.cleanup();
                this.groupCallHandler = null;
            }
            
            // Clear peers
            this.peers.clear();
            this.peerNicknames.clear();
            
            // Step 2: Store old user ID and generate new one
            console.log('[App] Step 2: Generating new user ID');
            const oldUserId = this.userId;  // Store old ID to clean up later
            this.userId = this.generateUserId();
            console.log('[App] Old user ID:', oldUserId);
            console.log('[App] New user ID:', this.userId);
            
            // Step 3: Rejoin everything fresh
            console.log('[App] Step 3: Rejoining room');
            this.roomId = this.savedRoomId;
            this.nickname = this.savedNickname;
            
            // Reinitialize WebRTC
            this.webrtcHandler = new WebRTCHandler(this.roomId, this.userId);
            this.setupWebRTCHandlers();
            
            // Reinitialize Call Handler
            this.callHandler = new CallHandler(this.webrtcHandler, this.userId, this.nickname);
            this.callHandler.initializeUI();

            // Reinitialize Group Call Handler
            this.groupCallHandler = new GroupCallHandler(this.webrtcHandler, this.userId, this.nickname);
            this.groupCallHandler.initializeUI();
            
            // Setup file handlers
            this.setupFileHandlers();
            
            // Rejoin Firebase room
            if (this.firebaseHandler) {
                console.log('[App] Rejoining Firebase room');
                const joinResult = await this.firebaseHandler.joinRoom(this.roomId, this.userId, this.nickname);
                if (joinResult) {
                    this.setupFirebaseHandlers();
                    
                    // Step 4: Clean up old ghost user from Firebase
                    if (oldUserId && oldUserId !== this.userId) {
                        console.log('[App] Cleaning up old ghost user:', oldUserId);
                        try {
                            // Remove old user from Firebase room
                            const oldUserRef = this.firebaseHandler.db.ref(`rooms/${this.roomId}/users/${oldUserId}`);
                            await oldUserRef.remove();
                            
                            // Also clean up any old signals
                            const oldSignalsRef = this.firebaseHandler.db.ref(`rooms/${this.roomId}/signals/${oldUserId}`);
                            await oldSignalsRef.remove();
                            
                            console.log('[App] Ghost user cleaned up successfully');
                        } catch (error) {
                            console.warn('[App] Could not clean up ghost user:', error);
                        }
                    }
                    
                    this.messageHandler.displaySystemMessage('✅ Reconnected successfully');
                    this.messageHandler.displaySystemMessage('⏳ Waiting for P2P connections...');
                } else {
                    throw new Error('Failed to rejoin Firebase room');
                }
            }
            
            // Update UI
            this.updateConnectionStatus(CONFIG.CONNECTION_STATE.CONNECTING);
            this.updatePeerCount();
            
        } catch (error) {
            console.error('[App] Manual reconnection failed:', error);
            this.messageHandler.displaySystemMessage('❌ Reconnection failed. Please try again.');
            this.updateConnectionStatus(CONFIG.CONNECTION_STATE.DISCONNECTED);
        } finally {
            if (reconnectBtn) {
                reconnectBtn.textContent = 'Reconnect';
                reconnectBtn.disabled = false;
            }
        }
    }

    // Update connection status indicator - CLEAR VERSION
    updateConnectionStatus(state) {
        this.connectionState = state;
        
        const dots = document.querySelectorAll('.status-dot');
        const reconnectBtn = document.getElementById('reconnectBtn');
        const callControls = document.getElementById('callControls');
        
        // Clear all dot states
        dots.forEach(dot => {
            dot.classList.remove('active-green', 'active-yellow', 'active-red', 'paused');
        });
        
        // Log status change
        console.log(`[App] Status Change: ${state}`);
        
        switch (state) {
            case CONFIG.CONNECTION_STATE.CONNECTED:
                // GREEN - Fully operational
                // Either: alone in room with Firebase, OR connected to all peers via P2P
                dots[2].classList.add('active-green');
                
                // No need for reconnect when connected
                if (reconnectBtn) reconnectBtn.style.display = 'none';
                
                // Show call controls only if we have P2P connections
                const p2pConnected = this.webrtcHandler?.getConnectedPeersCount() > 0;
                if (callControls) {
                    callControls.style.display = p2pConnected ? 'flex' : 'none';
                }
                break;
                
            case CONFIG.CONNECTION_STATE.CONNECTING:
                // YELLOW - In progress
                // In room with peers but establishing P2P connections
                dots[1].classList.add('active-yellow');
                
                // Hide reconnect during connection attempts
                if (reconnectBtn) reconnectBtn.style.display = 'none';
                
                // Hide call controls until fully connected
                if (callControls) callControls.style.display = 'none';
                break;
                
            case CONFIG.CONNECTION_STATE.DISCONNECTED:
                // RED - Connection lost
                // Either: not in room, OR in room but lost all connections
                dots[0].classList.add('active-red');
                
                // Show reconnect button when disconnected
                // Show reconnect ONLY if:
                // 1. We were in a room (have savedRoomId)
                // 2. We still want to be in that room (have roomId)
                // 3. We have peers but no P2P connections
                const inRoom = this.savedRoomId && this.roomId;
                const hasPeersButNoP2P = this.peers.size > 0 &&
                        (!this.webrtcHandler || this.webrtcHandler.getConnectedPeersCount() === 0);

                if (reconnectBtn) {
                    reconnectBtn.style.display = (inRoom && hasPeersButNoP2P) ? 'inline-block' : 'none';
                }

                // No calls when disconnected
                if (callControls) callControls.style.display = 'none';
                break;
        }
    }

    // Update connection status to paused
    updateConnectionStatusPaused() {
        const dots = document.querySelectorAll('.status-dot');
        dots.forEach(dot => {
            dot.classList.remove('active-green', 'active-yellow', 'active-red');
            dot.classList.add('paused');
        });
        
        const reconnectBtn = document.getElementById('reconnectBtn');
        const callControls = document.getElementById('callControls');
        
        // Hide reconnect button and call controls in paused state
        if (reconnectBtn) reconnectBtn.style.display = 'none';
        if (callControls) callControls.style.display = 'none';
        
        // Update peer count to show paused state
        const peerCountEl = document.getElementById('peerCount');
        if (peerCountEl) {
            peerCountEl.textContent = 'Paused';
        }
    }

    // Establish connection with retry logic
    async establishConnectionWithRetry(peerId, nickname, retries = 3) {
        for (let attempt = 1; attempt <= retries; attempt++) {
            console.log(`[App] Connection attempt ${attempt}/${retries} to ${nickname}`);
            
            try {
                // Check if already connected
                const connectedPeers = this.webrtcHandler.getConnectedPeerIds();
                if (connectedPeers.includes(peerId)) {
                    console.log(`[App] Already connected to ${peerId}`);
                    return;
                }
                
                // Try to create connection
                await this.webrtcHandler.createPeerConnection(peerId, true);
                
                // Wait a bit to see if connection establishes
                await new Promise(resolve => setTimeout(resolve, 3000));
                
                // Check if connected
                const connectedAfter = this.webrtcHandler.getConnectedPeerIds();
                if (connectedAfter.includes(peerId)) {
                    console.log(`[App] Successfully connected to ${peerId}`);
                    return;
                }
                
                console.log(`[App] Connection attempt ${attempt} failed, will retry...`);
            } catch (error) {
                console.error(`[App] Connection attempt ${attempt} error:`, error);
            }
            
            // Wait before retry
            if (attempt < retries) {
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }
        
        console.error(`[App] Failed to connect to ${nickname} after ${retries} attempts`);
    }

    // Update peer count and connection status - COMPREHENSIVE VERSION
    async updatePeerCount() {
        // Get accurate counts
        let totalUsersInRoom = 0;
        let otherPeersInRoom = 0;
        let p2pConnectedCount = 0;
        
        // Check Firebase room users
        if (this.firebaseHandler && this.firebaseHandler.roomRef) {
            try {
                const users = await this.firebaseHandler.getRoomUsers();
                totalUsersInRoom = users.length; // Includes self
                otherPeersInRoom = totalUsersInRoom - 1; // Exclude self
            } catch (error) {
                console.error('[App] Error getting room users:', error);
            }
        }
        
        // Get P2P connection count
        if (this.webrtcHandler) {
            p2pConnectedCount = this.webrtcHandler.getConnectedPeersCount();
        }
        
        // Log the state
        console.log(`[App] Connection State:
            - In Room: ${this.roomId ? 'Yes' : 'No'}
            - Total Users in Room: ${totalUsersInRoom}
            - Other Peers in Room: ${otherPeersInRoom}
            - P2P Connected: ${p2pConnectedCount}
            - Firebase Connected: ${this.firebaseHandler?.roomRef ? 'Yes' : 'No'}`);
        
        // Update peer count display
        const peerCountEl = document.getElementById('peerCount');
        if (peerCountEl) {
            if (!this.roomId) {
                // Not in a room
                peerCountEl.textContent = 'Not connected';
            } else if (totalUsersInRoom === 0) {
                // In room but can't get user count (Firebase issue)
                peerCountEl.textContent = 'Connecting...';
            } else if (totalUsersInRoom === 1) {
                // Alone in room
                peerCountEl.textContent = 'Alone (1 user)';
            } else {
                // Multiple users in room - show detailed status
                if (p2pConnectedCount === 0 && otherPeersInRoom > 0) {
                    // Others in room but no P2P connections
                    peerCountEl.textContent = `${totalUsersInRoom} users (No P2P)`;
                } else if (p2pConnectedCount < otherPeersInRoom) {
                    // Partially connected
                    peerCountEl.textContent = `${totalUsersInRoom} users (${p2pConnectedCount}/${otherPeersInRoom} P2P)`;
                } else {
                    // Fully connected
                    peerCountEl.textContent = `${totalUsersInRoom} users (All P2P)`;
                }
            }
        }
        
        // Determine connection state for status dots
        let connectionState;
        
        if (!this.roomId) {
            // Not in any room
            connectionState = CONFIG.CONNECTION_STATE.DISCONNECTED;
        } else if (otherPeersInRoom === 0) {
            // Alone in room (no peers to connect to)
            if (this.firebaseHandler?.roomRef) {
                // Connected to Firebase, just alone
                connectionState = CONFIG.CONNECTION_STATE.CONNECTED;
            } else {
                // Not even connected to Firebase
                connectionState = CONFIG.CONNECTION_STATE.DISCONNECTED;
            }
        } else if (p2pConnectedCount === otherPeersInRoom) {
            // Fully connected to all peers
            connectionState = CONFIG.CONNECTION_STATE.CONNECTED;
        } else if (p2pConnectedCount > 0) {
            // Partially connected
            connectionState = CONFIG.CONNECTION_STATE.CONNECTING;
        } else if (this.firebaseHandler?.roomRef) {
            // In Firebase room but no P2P connections yet
            connectionState = CONFIG.CONNECTION_STATE.CONNECTING;
        } else {
            // Lost all connections
            connectionState = CONFIG.CONNECTION_STATE.DISCONNECTED;
        }
        
        // Update the visual status
        this.updateConnectionStatus(connectionState);
    }

    // Leave room and cleanup
    leaveRoom() {
        // Clean up reconnection manager
        // No automatic reconnection to cleanup
        
        if (this.webrtcHandler) {
            this.webrtcHandler.disconnect();
        }
        
        if (this.firebaseHandler) {
            this.firebaseHandler.leaveRoom();
        }
        
        this.messageHandler.clearMessages();
        this.peers.clear();
        
        // Reset UI
        document.getElementById('roomModal').style.display = 'flex';
        document.getElementById('chatApp').style.display = 'none';
        document.getElementById('roomInput').value = '';
        document.getElementById('messageInput').disabled = true;
        document.getElementById('sendButton').disabled = true;
        
        this.updateConnectionStatus(CONFIG.CONNECTION_STATE.DISCONNECTED);
    }

    // Setup file handlers
    setupFileHandlers() {
        if (!this.fileHandler) return;
        
        // Handle file received
        this.fileHandler.onFileReceived((file) => {
            this.displayFileMessage(file, false);
        });
        
        // Handle file progress
        this.fileHandler.onProgress((fileId, progress, direction, metadata) => {
            this.updateFileProgress(fileId, progress, direction, metadata);
        });
    }
    
    // Handle file selection
    async handleFileSelect(files) {
        if (!files || files.length === 0) return;
        
        // Check if WebRTC is connected
        if (!this.webrtcHandler || !this.webrtcHandler.isConnected()) {
            this.messageHandler.displaySystemMessage('⏳ Please wait for P2P connection to be established before sharing files');
            document.getElementById('fileInput').value = ''; // Clear file input
            return;
        }
        
        // Send each file
        for (const file of files) {
            try {
                const metadata = await this.fileHandler.sendFile(file, this.webrtcHandler, this.nickname);
                this.displayFileMessage(metadata, true);
            } catch (error) {
                console.error('Failed to send file:', error);
                alert(`Failed to send ${file.name}: ${error.message}`);
            }
        }
    }
    
    // Display file message in chat
    displayFileMessage(fileData, isSent) {
        const messagesArea = document.getElementById('messagesArea');
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${isSent ? 'sent' : 'received'} file-message`;
        messageDiv.dataset.fileId = fileData.id;
        
        const time = new Date(fileData.timestamp || Date.now()).toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        });
        
        const isImage = this.fileHandler.isImage(fileData.type);
        
        messageDiv.innerHTML = `
            <div class="message-bubble file-bubble">
                ${!isSent ? `<div class="message-header">
                    <span class="message-sender">${fileData.senderNickname || 'Peer'}</span>
                </div>` : ''}
                <div class="file-content">
                    <div class="file-icon-wrapper" style="position: relative;">
                        <div class="file-icon">${isImage ? '🖼️' : '📄'}</div>
                        ${fileData.url ? 
                            `<a href="${fileData.url}" download="${fileData.name}" class="file-download-btn" title="Download ${fileData.name}">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                    <polyline points="7 10 12 15 17 10"></polyline>
                                    <line x1="12" y1="15" x2="12" y2="3"></line>
                                </svg>
                            </a>` : ''
                        }
                    </div>
                    <div class="file-info">
                        <div class="file-name">${this.escapeHtml(fileData.name)}</div>
                        <div class="file-size">${this.fileHandler.formatFileSize(fileData.size)}</div>
                        ${!fileData.url ? 
                            `<div class="file-progress" id="progress-${fileData.id}">
                                <div class="progress-bar" style="width: 0%"></div>
                            </div>` : ''
                        }
                    </div>
                </div>
                <div class="message-time">${time}</div>
            </div>
        `;
        
        messagesArea.appendChild(messageDiv);
        messagesArea.scrollTop = messagesArea.scrollHeight;
    }
    
    // Update file transfer progress
    updateFileProgress(fileId, progress, direction, metadata) {
        const progressEl = document.getElementById(`progress-${fileId}`);
        if (progressEl) {
            const progressBar = progressEl.querySelector('.progress-bar');
            if (progressBar) {
                progressBar.style.width = `${Math.round(progress * 100)}%`;
            }
            
            if (progress >= 1) {
                // Transfer complete
                setTimeout(() => {
                    if (direction === 'sending') {
                        progressEl.innerHTML = '<span class="file-sent">✓ Sent</span>';
                    }
                }, 500);
            }
        }
    }
    
    // Escape HTML for display
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    // Setup page visibility handling
    setupPageVisibilityHandling() {
        // Handle visibility change events
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                this.handlePageHidden();
            } else {
                this.handlePageVisible();
            }
        });
        
        // Also handle window blur/focus for additional coverage
        window.addEventListener('blur', () => {
            // Only handle if page is actually hidden (not just unfocused)
            if (document.hidden) {
                this.handlePageHidden();
            }
        });
        
        window.addEventListener('focus', () => {
            if (!document.hidden) {
                this.handlePageVisible();
            }
        });
        
        // Handle page unload (closing tab/window)
        window.addEventListener('beforeunload', () => {
            this.handlePageUnload();
        });
    }
    
    // Handle when page becomes hidden
    handlePageHidden() {
        if (!this.isPageVisible) return; // Already handled
        
        console.log('[App] Page hidden, starting 30-second timer');
        this.isPageVisible = false;
        this.hiddenTimestamp = Date.now();
        
        // Store connection state before hiding
        this.wasConnectedBeforeHidden = this.connectionState === CONFIG.CONNECTION_STATE.CONNECTED;
        
        // Show system message
        if (this.roomId) {
            this.messageHandler.displaySystemMessage('⏸️ Tab inactive - connection will pause in 30 seconds');
        }
        
        // Start 30-second timer
        this.disconnectTimer = setTimeout(() => {
            if (!this.isPageVisible && this.roomId) {
                console.log('[App] 30 seconds elapsed, pausing connections');
                this.pauseConnections();
            }
        }, 30000); // 30 seconds
    }
    
    // Handle when page becomes visible
    handlePageVisible() {
        if (this.isPageVisible) return; // Already visible
        
        console.log('[App] Page visible again');
        this.isPageVisible = true;
        
        // Clear disconnect timer if it exists
        if (this.disconnectTimer) {
            clearTimeout(this.disconnectTimer);
            this.disconnectTimer = null;
        }
        
        // Calculate how long we were hidden
        const hiddenDuration = this.hiddenTimestamp ? Date.now() - this.hiddenTimestamp : 0;
        const hiddenSeconds = Math.floor(hiddenDuration / 1000);
        
        // If we have a room and were hidden for more than 30 seconds, resume connections
        if (this.roomId && hiddenSeconds >= 30) {
            console.log(`[App] Was hidden for ${hiddenSeconds} seconds, resuming connections`);
            this.resumeConnections();
        } else if (this.roomId && hiddenSeconds > 0) {
            // Were hidden but less than 30 seconds
            this.messageHandler.displaySystemMessage(`✅ Tab active again (was away for ${hiddenSeconds} seconds)`);
        }
        
        this.hiddenTimestamp = null;
    }
    
    // Pause connections when tab is hidden for too long
    pauseConnections() {
        console.log('[App] Pausing connections due to inactivity');
        
        // Store current state for resume
        this.pausedState = {
            peers: new Set(this.peers),
            peerNicknames: new Map(this.peerNicknames),
            roomId: this.roomId,
            nickname: this.nickname
        };
        
        // Temporarily disconnect WebRTC but keep Firebase
        if (this.webrtcHandler) {
            // Set extended timeout to prevent disconnection during pause
            this.webrtcHandler.setInactivityPause(true);
            
            // Close data channels but keep peer connections
            this.webrtcHandler.pauseDataChannels();
        }
        
        // Update UI with paused state
        this.updateConnectionStatusPaused();
        this.messageHandler.displaySystemMessage('💤 Connection paused due to inactivity');
        
        // Disable input temporarily
        document.getElementById('messageInput').disabled = true;
        document.getElementById('sendButton').disabled = true;
        document.getElementById('fileButton').disabled = true;
    }
    
    // Resume connections when tab becomes active again
    async resumeConnections() {
        console.log('[App] Resuming connections');
        
        if (!this.pausedState || !this.roomId) {
            console.log('[App] No paused state to resume');
            return;
        }
        
        this.messageHandler.displaySystemMessage('🔄 Resuming connection...');
        
        // Re-enable WebRTC
        if (this.webrtcHandler) {
            this.webrtcHandler.setInactivityPause(false);
            
            // Resume data channels
            this.webrtcHandler.resumeDataChannels();
            
            // Check if connections are still alive
            const connectedPeers = this.webrtcHandler.getConnectedPeerIds();
            
            if (connectedPeers.length === 0 && this.pausedState.peers.size > 0) {
                // Lost all connections, need to reconnect
                console.log('[App] Lost connections during pause, reconnecting...');
                this.reconnect();
            } else {
                // Connections still alive
                console.log('[App] Connections resumed successfully');
                this.messageHandler.displaySystemMessage('✅ Connection resumed');
                
                // Re-enable input
                document.getElementById('messageInput').disabled = false;
                document.getElementById('sendButton').disabled = false;
                document.getElementById('fileButton').disabled = false;
                
                // Update connection status
                if (connectedPeers.length > 0) {
                    this.updateConnectionStatus(CONFIG.CONNECTION_STATE.CONNECTED);
                }
            }
        }
        
        this.pausedState = null;
    }
    
    // Handle page unload (tab/window closing)
    handlePageUnload() {
        console.log('[App] Page unloading, cleaning up...');
        
        // Clean disconnect from room
        if (this.webrtcHandler) {
            this.webrtcHandler.disconnect();
        }
        
        if (this.firebaseHandler && this.roomId) {
            // Firebase onDisconnect should handle cleanup
            console.log('[App] Firebase will clean up on disconnect');
        }
    }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.chatApp = new P2PChatApp();
});