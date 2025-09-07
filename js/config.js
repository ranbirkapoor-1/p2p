// Configuration for P2P Chat Application
const CONFIG = {
    // Maximum peers per room
    MAX_PEERS: 4,
    
    // WebRTC configuration
    ICE_SERVERS: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ],
    
    // Firebase configuration
    FIREBASE_CONFIG: {
        apiKey: "AIzaSyAhH6A7jKRRhTd3d082nhxw0OkRAABFANI",
        authDomain: "p-2-p-d2339.firebaseapp.com",
        databaseURL: "https://p-2-p-d2339-default-rtdb.firebaseio.com",
        projectId: "p-2-p-d2339",
        storageBucket: "p-2-p-d2339.firebasestorage.app",
        messagingSenderId: "85389967918",
        appId: "1:85389967918:web:391b170d6f426f69d615bf",
        measurementId: "G-PXW02NH5D8"
    },
    
    // Message settings
    MESSAGE_TIMEOUT: 30000, // 30 seconds for message delivery confirmation
    TYPING_TIMEOUT: 2000,   // 2 seconds typing indicator timeout
    
    // Connection states
    CONNECTION_STATE: {
        DISCONNECTED: 'disconnected',
        CONNECTING: 'connecting',
        CONNECTED: 'connected'
    },
    
    // Peer colors for identification
    PEER_COLORS: ['#00ccff', '#00ff88', '#ffaa00', '#ff6b6b']
};