// Improved Firebase Handler with comprehensive functionality
class FirebaseHandler {
    constructor() {
        this.db = null;
        this.roomRef = null;
        this.userRef = null;
        this.userId = null;
        this.roomId = null;
        this.nickname = null;
        this.listeners = [];
        this.isConnected = false;
        this.connectionRef = null;
        
        // Callbacks
        this.onMessageCallback = null;
        this.onPeerJoinedCallback = null;
        this.onPeerLeftCallback = null;
        this.onSignalCallback = null;
        this.onConnectionStateCallback = null;
        this.onTypingCallback = null;
        
        // Message queue for offline sending
        this.messageQueue = [];
        
        // Keep track of processed signals to avoid duplicates
        this.processedSignals = new Set();
    }

    // Initialize Firebase with proper error handling
    async initialize() {
        console.log('[Firebase] Starting initialization...');
        console.log('[Firebase] Config:', CONFIG.FIREBASE_CONFIG ? 'Found' : 'Missing');
        
        try {
            // Check if Firebase SDK is loaded
            if (typeof firebase === 'undefined') {
                console.error('[Firebase] Firebase SDK not loaded!');
                return false;
            }
            
            // Check if already initialized
            if (firebase.apps.length > 0) {
                console.log('[Firebase] Already initialized, reusing existing app');
                this.db = firebase.database();
            } else {
                // Initialize Firebase with config
                console.log('[Firebase] Initializing new Firebase app...');
                firebase.initializeApp(CONFIG.FIREBASE_CONFIG);
                this.db = firebase.database();
                console.log('[Firebase] ✅ Initialized successfully');
            }
            
            // Test database connection
            const testRef = this.db.ref('.info/connected');
            testRef.once('value', (snapshot) => {
                console.log('[Firebase] Database connection test:', snapshot.val() ? 'CONNECTED' : 'NOT CONNECTED');
            });
            
            // Monitor connection state
            this.setupConnectionMonitoring();
            
            return true;
        } catch (error) {
            console.error('[Firebase] Initialization error:', error);
            console.error('[Firebase] Error details:', error.message, error.stack);
            return false;
        }
    }

    // Monitor Firebase connection state
    setupConnectionMonitoring() {
        if (!this.db) return;
        
        this.connectionRef = this.db.ref('.info/connected');
        this.connectionRef.on('value', (snapshot) => {
            const connected = snapshot.val();
            const wasConnected = this.isConnected;
            this.isConnected = connected;
            
            console.log(`[Firebase] Connection state: ${connected ? 'ONLINE' : 'OFFLINE'}`);
            
            if (this.onConnectionStateCallback) {
                this.onConnectionStateCallback(connected);
            }
            
            // Handle reconnection
            if (!wasConnected && connected && this.roomId && this.userId) {
                console.log('[Firebase] Reconnected - restoring presence');
                this.restorePresence();
            }
            
            // Process queued messages when reconnected
            if (connected && this.messageQueue.length > 0) {
                this.flushMessageQueue();
            }
        });
    }

    // Join a room with comprehensive setup
    async joinRoom(roomId, userId, nickname) {
        console.log(`[Firebase] Joining room: ${roomId} as ${nickname} (${userId})`);
        
        this.roomId = roomId;
        this.userId = userId;
        this.nickname = nickname || 'Anonymous';
        
        if (!this.db) {
            console.error('[Firebase] Database not initialized');
            return false;
        }
        
        try {
            // Clear any previous room data
            if (this.roomRef) {
                await this.leaveRoom();
            }
            
            // Reference to the room
            this.roomRef = this.db.ref(`rooms/${roomId}`);
            
            // Set user presence with detailed info
            this.userRef = this.roomRef.child(`users/${userId}`);
            const userData = {
                joinedAt: firebase.database.ServerValue.TIMESTAMP,
                status: 'online',
                nickname: this.nickname,
                userId: userId
            };
            
            await this.userRef.set(userData);
            console.log('[Firebase] User presence set');
            
            // Setup disconnect handling
            await this.userRef.onDisconnect().remove();
            
            // Start listening for room events
            this.listenForUsers();
            this.listenForMessages();
            this.listenForSignals();
            this.listenForTyping();
            
            console.log('[Firebase] ✅ Successfully joined room');
            return true;
            
        } catch (error) {
            console.error('[Firebase] Error joining room:', error);
            return false;
        }
    }

    // Restore presence after reconnection
    async restorePresence() {
        if (!this.userRef) return;

        try {
            await this.userRef.update({
                status: 'online'
            });
            console.log('[Firebase] Presence restored');
        } catch (error) {
            console.error('[Firebase] Error restoring presence:', error);
        }
    }


    // Listen for users with improved handling
    listenForUsers() {
        if (!this.roomRef) return;
        
        const usersRef = this.roomRef.child('users');
        let initialDataLoaded = false;
        
        // Get existing users first
        usersRef.once('value', (snapshot) => {
            const users = [];
            snapshot.forEach((childSnapshot) => {
                const peerId = childSnapshot.key;
                const userData = childSnapshot.val();
                if (peerId !== this.userId) {
                    users.push({
                        id: peerId,
                        ...userData
                    });
                }
            });
            
            console.log(`[Firebase] Found ${users.length} existing users in room`);
            
            // Notify about existing users
            users.forEach(user => {
                if (this.onPeerJoinedCallback) {
                    this.onPeerJoinedCallback(user.id, user.nickname, true);
                }
            });
            
            initialDataLoaded = true;
        });
        
        // Listen for new users
        const joinListener = usersRef.on('child_added', (snapshot) => {
            if (!initialDataLoaded) return;
            
            const peerId = snapshot.key;
            const userData = snapshot.val();
            
            if (peerId !== this.userId) {
                console.log(`[Firebase] New user joined: ${userData.nickname} (${peerId})`);
                if (this.onPeerJoinedCallback) {
                    this.onPeerJoinedCallback(peerId, userData.nickname, false);
                }
            }
        });
        
        // Listen for user updates (status changes)
        const updateListener = usersRef.on('child_changed', (snapshot) => {
            const peerId = snapshot.key;
            const userData = snapshot.val();
            
            if (peerId !== this.userId) {
                console.log(`[Firebase] User updated: ${userData.nickname} - ${userData.status}`);
                // Could handle status updates here
            }
        });
        
        // Listen for users leaving
        const leftListener = usersRef.on('child_removed', (snapshot) => {
            const peerId = snapshot.key;
            const userData = snapshot.val();
            
            if (peerId !== this.userId) {
                console.log(`[Firebase] User left: ${userData.nickname} (${peerId})`);
                if (this.onPeerLeftCallback) {
                    this.onPeerLeftCallback(peerId, userData.nickname);
                }
            }
        });
        
        // Store listeners for cleanup
        this.listeners.push(
            { ref: usersRef, event: 'child_added', listener: joinListener },
            { ref: usersRef, event: 'child_changed', listener: updateListener },
            { ref: usersRef, event: 'child_removed', listener: leftListener }
        );
    }

    // Listen for messages with deduplication
    listenForMessages() {
        if (!this.roomRef) return;
        
        const messagesRef = this.roomRef.child('messages');
        const processedMessages = new Set();
        
        // Limit to last 100 messages
        const messageListener = messagesRef.limitToLast(100).on('child_added', (snapshot) => {
            const message = snapshot.val();
            const messageId = snapshot.key;
            
            // Skip if already processed or from self
            if (processedMessages.has(messageId) || message.senderId === this.userId) {
                return;
            }
            
            processedMessages.add(messageId);
            
            console.log(`[Firebase] Message received from ${message.senderNickname}`);
            
            if (this.onMessageCallback) {
                this.onMessageCallback(message, message.senderId);
            }
            
            // Clean old messages to prevent memory leak
            if (processedMessages.size > 200) {
                const oldMessages = Array.from(processedMessages).slice(0, 100);
                oldMessages.forEach(id => processedMessages.delete(id));
            }
        });
        
        this.listeners.push({ ref: messagesRef, event: 'child_added', listener: messageListener });
    }

    // Listen for WebRTC signaling
    listenForSignals() {
        if (!this.roomRef || !this.userId) return;
        
        const signalsRef = this.roomRef.child(`signals/${this.userId}`);
        
        const signalListener = signalsRef.on('child_added', (snapshot) => {
            const signal = snapshot.val();
            const signalId = snapshot.key;
            
            // Skip if already processed
            if (this.processedSignals.has(signalId)) {
                snapshot.ref.remove();
                return;
            }
            
            this.processedSignals.add(signalId);
            
            console.log(`[Firebase] Signal received from ${signal.from}: ${signal.data.type}`);
            
            // Delete the signal after processing
            snapshot.ref.remove();
            
            if (this.onSignalCallback) {
                this.onSignalCallback(signal.from, signal.data);
            }
            
            // Clean old processed signals
            if (this.processedSignals.size > 100) {
                const oldSignals = Array.from(this.processedSignals).slice(0, 50);
                oldSignals.forEach(id => this.processedSignals.delete(id));
            }
        });
        
        this.listeners.push({ ref: signalsRef, event: 'child_added', listener: signalListener });
    }

    // Listen for typing indicators
    listenForTyping() {
        if (!this.roomRef) return;
        
        const typingRef = this.roomRef.child('typing');
        
        const typingListener = typingRef.on('value', (snapshot) => {
            const typingUsers = [];
            
            snapshot.forEach((childSnapshot) => {
                const userId = childSnapshot.key;
                const typingData = childSnapshot.val();
                
                if (userId !== this.userId && typingData.isTyping) {
                    // Check if typing indicator is not stale (older than 3 seconds)
                    const now = Date.now();
                    if (now - typingData.timestamp < 3000) {
                        typingUsers.push({
                            userId: userId,
                            nickname: typingData.nickname
                        });
                    }
                }
            });
            
            if (this.onTypingCallback) {
                this.onTypingCallback(typingUsers);
            }
        });
        
        this.listeners.push({ ref: typingRef, event: 'value', listener: typingListener });
    }

    // Send a message via Firebase
    async sendMessage(message) {
        if (!this.roomRef) {
            console.error('[Firebase] Cannot send message - not in room');
            return false;
        }
        
        // Add to queue if offline
        if (!this.isConnected) {
            console.log('[Firebase] Offline - queuing message');
            this.messageQueue.push(message);
            return false;
        }
        
        try {
            const messagesRef = this.roomRef.child('messages');
            await messagesRef.push({
                ...message,
                timestamp: firebase.database.ServerValue.TIMESTAMP
            });
            
            console.log('[Firebase] Message sent successfully');
            return true;
        } catch (error) {
            console.error('[Firebase] Error sending message:', error);
            this.messageQueue.push(message);
            return false;
        }
    }

    // Send typing indicator
    async sendTypingIndicator(isTyping) {
        if (!this.roomRef || !this.userId) return;
        
        try {
            const typingRef = this.roomRef.child(`typing/${this.userId}`);
            
            if (isTyping) {
                await typingRef.set({
                    isTyping: true,
                    nickname: this.nickname,
                    timestamp: Date.now()
                });
                
                // Auto-remove after 3 seconds
                setTimeout(() => {
                    typingRef.remove();
                }, 3000);
            } else {
                await typingRef.remove();
            }
        } catch (error) {
            console.error('[Firebase] Error sending typing indicator:', error);
        }
    }

    // Send WebRTC signal (compatible with webrtc-handler call signature)
    async sendSignal(roomId, fromId, toId, signalData) {
        // Support both call signatures for compatibility
        let targetPeer, signal;
        
        if (arguments.length === 2) {
            // Called with (targetPeer, signalData)
            targetPeer = roomId;
            signal = fromId;
        } else {
            // Called with (roomId, fromId, toId, signalData)
            targetPeer = toId;
            signal = signalData;
        }
        
        if (!this.roomRef || !this.userId) {
            console.error('[Firebase] Cannot send signal - not in room');
            return false;
        }
        
        try {
            const signalRef = this.roomRef.child(`signals/${targetPeer}`);
            await signalRef.push({
                from: this.userId,
                data: signal,
                timestamp: firebase.database.ServerValue.TIMESTAMP
            });
            
            console.log(`[Firebase] Signal sent to ${targetPeer}: ${signal.type}`);
            return true;
        } catch (error) {
            console.error('[Firebase] Error sending signal:', error);
            return false;
        }
    }

    // Get list of users in room
    async getRoomUsers() {
        if (!this.roomRef) return [];
        
        try {
            const snapshot = await this.roomRef.child('users').once('value');
            const users = [];
            
            snapshot.forEach((childSnapshot) => {
                const userData = childSnapshot.val();
                users.push({
                    id: childSnapshot.key,
                    ...userData
                });
            });
            
            return users;
        } catch (error) {
            console.error('[Firebase] Error getting room users:', error);
            return [];
        }
    }

    // Flush message queue
    async flushMessageQueue() {
        if (this.messageQueue.length === 0) return;
        
        console.log(`[Firebase] Flushing ${this.messageQueue.length} queued messages`);
        
        const queue = [...this.messageQueue];
        this.messageQueue = [];
        
        for (const message of queue) {
            await this.sendMessage(message);
        }
    }

    // Leave room and cleanup
    async leaveRoom() {
        console.log('[Firebase] Leaving room');

        // Remove user from room
        if (this.userRef) {
            try {
                await this.userRef.remove();
            } catch (error) {
                console.error('[Firebase] Error removing user:', error);
            }
        }

        // Clear typing indicator
        if (this.roomRef && this.userId) {
            try {
                await this.roomRef.child(`typing/${this.userId}`).remove();
            } catch (error) {
                console.error('[Firebase] Error removing typing:', error);
            }
        }

        // Check if room should be deleted
        if (this.roomRef) {
            try {
                const roomSnapshot = await this.roomRef.once('value');
                const roomData = roomSnapshot.val();

                if (roomData) {
                    // Check if any users left
                    const hasUsers = roomData.users && Object.keys(roomData.users).length > 0;
                    // Check if any messages exist
                    const hasMessages = roomData.messages && Object.keys(roomData.messages).length > 0;

                    if (!hasUsers) {
                        if (hasMessages) {
                            // Keep messages but clean up other data
                            console.log('[Firebase] Room has messages - cleaning up non-message data');

                            // Remove all data except messages
                            const updates = {};
                            for (const key in roomData) {
                                if (key !== 'messages') {
                                    updates[key] = null; // Mark for deletion
                                }
                            }

                            if (Object.keys(updates).length > 0) {
                                await this.roomRef.update(updates);
                            }
                        } else {
                            // No users and no messages - delete entire room
                            console.log('[Firebase] Room is empty - removing entire room');
                            await this.roomRef.remove();
                        }
                    }
                }
            } catch (error) {
                console.error('[Firebase] Error checking room status:', error);
            }
        }

        // Remove all listeners
        this.listeners.forEach(({ ref, event, listener }) => {
            ref.off(event, listener);
        });
        this.listeners = [];

        // Clear references
        this.roomRef = null;
        this.userRef = null;
        this.roomId = null;

        // Clear processed signals
        this.processedSignals.clear();

        console.log('[Firebase] Left room successfully');
    }

    // Set callbacks
    onMessage(callback) {
        this.onMessageCallback = callback;
    }

    onPeerJoined(callback) {
        this.onPeerJoinedCallback = callback;
    }

    onPeerLeft(callback) {
        this.onPeerLeftCallback = callback;
    }

    onSignal(callback) {
        this.onSignalCallback = callback;
    }

    onConnectionState(callback) {
        this.onConnectionStateCallback = callback;
    }

    onTyping(callback) {
        this.onTypingCallback = callback;
    }
}

// Create global instance
window.firebaseHandler = new FirebaseHandler();

// Also export the class if needed
window.FirebaseHandler = FirebaseHandler;