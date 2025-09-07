// Message Handler - Implements dual delivery system
class MessageHandler {
    constructor() {
        this.messages = new Map(); // Store messages by ID for deduplication
        this.messageCallbacks = [];
        this.typingTimers = new Map();
    }

    // Generate unique message ID
    generateMessageId() {
        return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    // Send message through WebRTC first, Firebase as fallback
    async sendMessage(text, webrtcHandler, firebaseHandler, nickname) {
        const message = {
            id: this.generateMessageId(),
            text: text,
            timestamp: Date.now(),
            senderId: firebaseHandler?.userId || 'anonymous',
            senderNickname: nickname || 'Anonymous'
        };

        // Track sent message
        this.messages.set(message.id, {
            ...message,
            sent: true,
            delivered: false,
            method: null
        });

        let messageSent = false;
        let sendMethod = null;

        // Try WebRTC first if connected
        if (webrtcHandler && webrtcHandler.isConnected()) {
            messageSent = webrtcHandler.sendMessage(message);
            if (messageSent) {
                sendMethod = 'webrtc';
                console.log('✅ Message sent via WebRTC (P2P)');
            }
        } else if (webrtcHandler && !webrtcHandler.isConnected()) {
            // P2P not ready yet, show warning once
            if (!this.warnedAboutP2P) {
                this.displaySystemMessage('⚠️ P2P not connected. Sending via Firebase (unencrypted)');
                this.warnedAboutP2P = true;
                // Reset warning after 30 seconds
                setTimeout(() => { this.warnedAboutP2P = false; }, 30000);
            }
        }

        // Use Firebase only as fallback if WebRTC failed or not connected
        if (!messageSent && firebaseHandler) {
            messageSent = await firebaseHandler.sendMessage(message);
            if (messageSent) {
                sendMethod = 'firebase';
                console.log('📡 Message sent via Firebase (fallback)');
            }
        }

        // Update delivery status
        if (messageSent) {
            const tracked = this.messages.get(message.id);
            tracked.delivered = true;
            tracked.method = sendMethod;
            return message;
        }

        console.error('❌ Failed to send message through any channel');
        return null;
    }

    // Receive message (handles deduplication)
    receiveMessage(message, source) {
        // Check if we've already received this message
        if (this.messages.has(message.id)) {
            // Silently ignore duplicates (this is expected behavior)
            return false;
        }

        // Store message
        this.messages.set(message.id, {
            ...message,
            received: true,
            source: source
        });

        // Log based on source
        if (source === 'webrtc') {
            console.log(`✅ Message received via WebRTC (P2P)`);
        } else if (source === 'firebase') {
            console.log(`📡 Message received via Firebase`);
        }

        // Notify callbacks
        this.messageCallbacks.forEach(callback => {
            callback(message, source);
        });

        return true;
    }

    // Handle typing indicators with nicknames
    handleTyping(userId, nickname, isTyping) {
        console.log(`Handling typing: ${nickname} (${userId}) - ${isTyping ? 'started' : 'stopped'} typing`);
        
        if (isTyping) {
            // Clear existing timer
            if (this.typingTimers.has(userId)) {
                clearTimeout(this.typingTimers.get(userId).timer);
            }

            // Set new timer to auto-clear typing indicator
            const timer = setTimeout(() => {
                this.typingTimers.delete(userId);
                this.updateTypingIndicator();
            }, CONFIG.TYPING_TIMEOUT);

            this.typingTimers.set(userId, { timer, nickname });
        } else {
            // Clear typing for this user
            if (this.typingTimers.has(userId)) {
                clearTimeout(this.typingTimers.get(userId).timer);
                this.typingTimers.delete(userId);
            }
        }

        this.updateTypingIndicator();
    }

    // Update typing indicator UI with nicknames
    updateTypingIndicator() {
        const typingIndicator = document.getElementById('typingIndicator');
        const typingText = document.getElementById('typingText');
        
        console.log(`Updating typing indicator. Active typers: ${this.typingTimers.size}`);
        
        if (this.typingTimers.size > 0) {
            // Show typing indicator
            typingIndicator.style.display = 'flex';
            typingIndicator.classList.add('active');
            
            // Get all nicknames of typing users
            const typingUsers = Array.from(this.typingTimers.values()).map(u => u.nickname);
            
            if (this.typingTimers.size === 1) {
                typingText.textContent = `${typingUsers[0]} is typing...`;
            } else if (this.typingTimers.size === 2) {
                typingText.textContent = `${typingUsers[0]} and ${typingUsers[1]} are typing...`;
            } else {
                typingText.textContent = `${typingUsers.slice(0, -1).join(', ')} and ${typingUsers[typingUsers.length - 1]} are typing...`;
            }
            
            console.log(`Typing text: ${typingText.textContent}`);
        } else {
            // Hide typing indicator
            typingIndicator.style.display = 'none';
            typingIndicator.classList.remove('active');
        }
    }

    // Display message in UI
    displayMessage(message, isSent = false) {
        const messagesArea = document.getElementById('messagesArea');
        
        // Create message element
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${isSent ? 'sent' : 'received'}`;
        messageDiv.dataset.messageId = message.id;
        
        const time = new Date(message.timestamp).toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        });

        messageDiv.innerHTML = `
            <div class="message-bubble">
                ${!isSent ? `<div class="message-header">
                    <span class="message-sender">${message.senderNickname || message.senderId || 'Peer'}</span>
                </div>` : ''}
                <div class="message-text">${this.escapeHtml(message.text)}</div>
                <div class="message-time">${time}</div>
            </div>
        `;

        // Append message
        messagesArea.appendChild(messageDiv);
        
        // Scroll to bottom
        messagesArea.scrollTop = messagesArea.scrollHeight;

        return messageDiv;
    }

    // Display system message
    displaySystemMessage(text) {
        const messagesArea = document.getElementById('messagesArea');
        
        const systemDiv = document.createElement('div');
        systemDiv.className = 'system-message';
        systemDiv.textContent = text;
        
        // Append to messages area
        messagesArea.appendChild(systemDiv);
        
        messagesArea.scrollTop = messagesArea.scrollHeight;
    }

    // Escape HTML to prevent XSS
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Register message callback
    onMessage(callback) {
        this.messageCallbacks.push(callback);
    }

    // Clear all messages
    clearMessages() {
        this.messages.clear();
        const messagesArea = document.getElementById('messagesArea');
        messagesArea.innerHTML = '<div class="typing-indicator" id="typingIndicator"><div class="typing-dots"><span></span><span></span><span></span></div><span id="typingText">Someone is typing</span></div>';
    }

    // Get message statistics
    getStats() {
        let sent = 0;
        let received = 0;
        let webrtc = 0;
        let firebase = 0;

        this.messages.forEach(msg => {
            if (msg.sent) sent++;
            if (msg.received) received++;
            if (msg.source === 'webrtc') webrtc++;
            if (msg.source === 'firebase') firebase++;
        });

        return { sent, received, webrtc, firebase };
    }
}