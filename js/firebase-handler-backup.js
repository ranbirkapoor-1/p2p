// Firebase Handler for signaling and fallback messaging
class FirebaseHandler {
    constructor() {
        this.db = null;
        this.roomRef = null;
        this.userId = null;
        this.roomId = null;
        this.listeners = [];
        this.onMessageCallback = null;
        this.onPeerJoinedCallback = null;
        this.onPeerLeftCallback = null;
        this.onSignalCallback = null;
    }

    // Initialize Firebase
    async initialize() {
        try {
            // Initialize Firebase with config
            firebase.initializeApp(CONFIG.FIREBASE_CONFIG);
            this.db = firebase.database();
            console.log('✅ Firebase backup channel ready');
            return true;
        } catch (error) {
            console.error('Firebase initialization error:', error);
            return false;
        }
    }

    // Join a room
    async joinRoom(roomId, userId, nickname) {
        this.roomId = roomId;
        this.userId = userId;
        this.nickname = nickname || 'Anonymous';

        if (!this.db) {
            console.warn('Firebase not initialized - running in offline mode');
            return;
        }

        // Reference to the room
        this.roomRef = this.db.ref(`rooms/${roomId}`);
        
        // Set user presence with nickname
        const userRef = this.roomRef.child(`users/${userId}`);
        await userRef.set({
            joinedAt: firebase.database.ServerValue.TIMESTAMP,
            status: 'online',
            nickname: this.nickname
        });

        // Remove user on disconnect
        userRef.onDisconnect().remove();

        // Listen for new users
        this.listenForUsers();
        
        // Listen for messages
        this.listenForMessages();
        
        // Listen for signaling
        this.listenForSignals();

        // Silently joined room
    }

    // Listen for users joining/leaving
    listenForUsers() {
        const usersRef = this.roomRef.child('users');
        
        // Track if we're getting initial data or new joins
        let initialDataLoaded = false;
        
        // Get existing users first (without triggering join messages)
        usersRef.once('value', (snapshot) => {
            // Process existing users silently
            snapshot.forEach((childSnapshot) => {
                const peerId = childSnapshot.key;
                const userData = childSnapshot.val();
                if (peerId !== this.userId) {
                    const nickname = userData?.nickname || 'Anonymous';
                    // Pass true to indicate this is an existing user
                    if (this.onPeerJoinedCallback) {
                        this.onPeerJoinedCallback(peerId, nickname, true);
                    }
                }
            });
            initialDataLoaded = true;
        });
        
        // Then listen for new users joining
        const joinListener = usersRef.on('child_added', (snapshot) => {
            if (!initialDataLoaded) return; // Skip initial data
            
            const peerId = snapshot.key;
            const userData = snapshot.val();
            if (peerId !== this.userId) {
                // User joined with nickname
                const nickname = userData?.nickname || 'Anonymous';
                if (this.onPeerJoinedCallback) {
                    // Pass false to indicate this is a new user
                    this.onPeerJoinedCallback(peerId, nickname, false);
                }
            }
        });

        // User left
        const leftListener = usersRef.on('child_removed', (snapshot) => {
            const peerId = snapshot.key;
            const userData = snapshot.val();
            // User left with nickname
            const nickname = userData?.nickname || 'Anonymous';
            if (this.onPeerLeftCallback) {
                this.onPeerLeftCallback(peerId, nickname);
            }
        });

        this.listeners.push({ ref: usersRef, event: 'child_added', listener: joinListener });
        this.listeners.push({ ref: usersRef, event: 'child_removed', listener: leftListener });
    }

    // Listen for messages via Firebase
    listenForMessages() {
        const messagesRef = this.roomRef.child('messages');
        
        const messageListener = messagesRef.on('child_added', (snapshot) => {
            const message = snapshot.val();
            if (message.senderId !== this.userId) {
                // Message received via Firebase
                if (this.onMessageCallback) {
                    this.onMessageCallback(message, message.senderId);
                }
            }
        });

        this.listeners.push({ ref: messagesRef, event: 'child_added', listener: messageListener });
    }

    // Listen for WebRTC signaling messages
    listenForSignals() {
        const signalsRef = this.roomRef.child(`signals/${this.userId}`);
        
        const signalListener = signalsRef.on('child_added', (snapshot) => {
            const signal = snapshot.val();
            // Signal received
            
            // Delete the signal after processing
            snapshot.ref.remove();
            
            if (this.onSignalCallback) {
                this.onSignalCallback(signal.from, signal.data);
            }
        });

        this.listeners.push({ ref: signalsRef, event: 'child_added', listener: signalListener });
    }

    // Send message via Firebase
    async sendMessage(message) {
        if (!this.roomRef) {
            console.warn('Not connected to Firebase');
            return false;
        }

        try {
            const messagesRef = this.roomRef.child('messages');
            await messagesRef.push({
                ...message,
                senderId: this.userId,
                senderNickname: this.nickname,
                timestamp: firebase.database.ServerValue.TIMESTAMP
            });
            // Message sent via Firebase
            return true;
        } catch (error) {
            console.error('Failed to send message via Firebase:', error);
            return false;
        }
    }

    // Send WebRTC signaling message
    async sendSignal(roomId, fromId, toId, signal) {
        if (!this.db) {
            console.warn('Firebase not initialized');
            return;
        }

        try {
            const signalRef = this.db.ref(`rooms/${roomId}/signals/${toId}`);
            await signalRef.push({
                from: fromId,
                data: signal,
                timestamp: firebase.database.ServerValue.TIMESTAMP
            });
            // Signal sent
        } catch (error) {
            console.error('Failed to send signal:', error);
        }
    }

    // Send typing indicator
    async sendTypingIndicator(isTyping) {
        if (!this.roomRef) return;

        const typingRef = this.roomRef.child(`typing/${this.userId}`);
        if (isTyping) {
            await typingRef.set({
                timestamp: firebase.database.ServerValue.TIMESTAMP
            });
            // Auto-remove after timeout
            setTimeout(() => {
                typingRef.remove();
            }, CONFIG.TYPING_TIMEOUT);
        } else {
            await typingRef.remove();
        }
    }

    // Get room users
    async getRoomUsers() {
        if (!this.roomRef) return [];

        try {
            const snapshot = await this.roomRef.child('users').once('value');
            const users = [];
            snapshot.forEach((child) => {
                users.push({
                    id: child.key,
                    ...child.val()
                });
            });
            return users;
        } catch (error) {
            console.error('Failed to get room users:', error);
            return [];
        }
    }

    // Leave room and cleanup
    async leaveRoom() {
        // Remove user from room
        if (this.roomRef && this.userId) {
            await this.roomRef.child(`users/${this.userId}`).remove();
        }

        // Remove all listeners
        this.listeners.forEach(({ ref, event, listener }) => {
            ref.off(event, listener);
        });
        this.listeners = [];

        this.roomRef = null;
        this.roomId = null;
        console.log('Left room');
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
}

// Backup file - not creating global instance to avoid conflicts
// window.firebaseHandler = new FirebaseHandler();