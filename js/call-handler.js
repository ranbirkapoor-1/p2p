// Call Handler for Audio/Video calls
class CallHandler {
    constructor(webrtcHandler, userId, nickname) {
        this.webrtcHandler = webrtcHandler;
        this.userId = userId;
        this.nickname = nickname;
        
        // Call state
        this.currentCall = null;
        this.localStream = null;
        this.remoteStream = null;
        this.remoteStreams = new Map(); // Map of peerId -> MediaStream for multiple peers
        this.activePeers = new Set(); // Peers currently in call
        this.callTimer = null;
        this.callStartTime = null;
        
        // Callbacks
        this.onIncomingCallCallback = null;
        this.onCallEndedCallback = null;
        
        // Bind methods
        this.handleIncomingCall = this.handleIncomingCall.bind(this);
        this.handleCallAccepted = this.handleCallAccepted.bind(this);
        this.handleCallRejected = this.handleCallRejected.bind(this);
        this.handleCallEnded = this.handleCallEnded.bind(this);
        this.handleRemoteStream = this.handleRemoteStream.bind(this);
    }
    
    // Check if we have permissions for media
    async checkMediaPermissions(needVideo = false) {
        try {
            // Try to get a quick media stream to check permissions
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: true,
                video: needVideo
            });
            
            // Stop all tracks immediately
            stream.getTracks().forEach(track => track.stop());
            
            return true;
        } catch (error) {
            console.log('Media permission check failed:', error.name);
            return false;
        }
    }
    
    // Request media permissions
    async requestMediaPermissions(needVideo = false) {
        try {
            const mediaType = needVideo ? 'camera and microphone' : 'microphone';
            
            // Show a friendly message first
            const proceed = confirm(`This app needs access to your ${mediaType} to make calls.\n\nClick OK to grant permission.`);
            
            if (!proceed) {
                return false;
            }
            
            // Request permissions
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: true,
                video: needVideo
            });
            
            // Stop tracks immediately
            stream.getTracks().forEach(track => track.stop());
            
            return true;
        } catch (error) {
            return false;
        }
    }
    
    // Initialize call UI
    initializeUI() {
        // Get UI elements
        this.audioCallBtn = document.getElementById('audioCallBtn');
        this.videoCallBtn = document.getElementById('videoCallBtn');
        this.callInterface = document.getElementById('callInterface');
        this.incomingCallModal = document.getElementById('incomingCallModal');
        this.acceptCallBtn = document.getElementById('acceptCallBtn');
        this.rejectCallBtn = document.getElementById('rejectCallBtn');
        this.endCallBtn = document.getElementById('endCallBtn');
        this.muteBtn = document.getElementById('muteBtn');
        this.videoToggleBtn = document.getElementById('videoToggleBtn');
        this.localVideo = document.getElementById('localVideo');
        this.videosGrid = document.getElementById('videosGrid'); // Grid container for multiple videos
        this.callStatus = document.getElementById('callStatus');
        this.callTimer = document.getElementById('callTimer');
        this.callerName = document.getElementById('callerName');
        this.callControls = document.getElementById('callControls');
        
        // Map to store video elements for each peer
        this.peerVideoElements = new Map();
        
        // Setup event listeners
        this.setupEventListeners();
    }
    
    // Setup event listeners
    setupEventListeners() {
        // Call buttons
        this.audioCallBtn?.addEventListener('click', () => this.startCall(false));
        this.videoCallBtn?.addEventListener('click', () => this.startCall(true));
        
        // Incoming call actions
        this.acceptCallBtn?.addEventListener('click', () => this.acceptCall());
        this.rejectCallBtn?.addEventListener('click', () => this.rejectCall());
        
        // In-call actions
        this.endCallBtn?.addEventListener('click', () => this.endCall());
        this.muteBtn?.addEventListener('click', () => this.toggleMute());
        this.videoToggleBtn?.addEventListener('click', () => this.toggleVideo());
    }
    
    // Enable call buttons when P2P is connected
    async enableCallButtons() {
        if (this.audioCallBtn) this.audioCallBtn.disabled = false;
        if (this.videoCallBtn) this.videoCallBtn.disabled = false;
        if (this.callControls) this.callControls.style.display = 'flex';
        
        // Pre-request microphone permission to avoid issues later
        console.log('Pre-requesting microphone permission...');
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            stream.getTracks().forEach(track => track.stop());
            console.log('Microphone permission granted');
        } catch (error) {
            console.warn('Could not pre-request microphone:', error.name);
            // Don't disable buttons, user might grant permission when needed
        }
    }
    
    // Disable call buttons
    disableCallButtons() {
        if (this.audioCallBtn) this.audioCallBtn.disabled = true;
        if (this.videoCallBtn) this.videoCallBtn.disabled = true;
    }
    
    // Start a call
    async startCall(withVideo = false) {
        // NOTE: Current implementation supports 1-to-1 calls only
        // For mesh calls with multiple peers, this would need major refactoring:
        // - Support calling multiple peers simultaneously
        // - Create video grid layout for multiple remote streams
        // - Handle peer join/leave during active calls
        // - Manage bandwidth for multiple video streams
        
        if (this.currentCall) {
            console.log('Already in a call');
            return;
        }
        
        try {
            // Check if mediaDevices is available
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                throw new Error('Media devices not supported. Please ensure you are using HTTPS.');
            }
            
            // Start with basic constraints
            let constraints = {
                audio: true,
                video: withVideo
            };
            
            console.log('Starting call with constraints:', constraints);
            
            try {
                this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
            } catch (firstError) {
                console.error('Failed with basic constraints:', firstError);
                
                // If video fails, try audio only
                if (withVideo) {
                    console.log('Trying audio-only fallback...');
                    constraints = { audio: true, video: false };
                    this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
                    this.messageHandler.displaySystemMessage('⚠️ Camera unavailable, starting audio-only call');
                } else {
                    throw firstError;
                }
            }
            
            // Log tracks obtained
            console.log('Got local stream with tracks:');
            this.localStream.getTracks().forEach(track => {
                console.log(`  - ${track.kind}: ${track.label}, enabled: ${track.enabled}, muted: ${track.muted}`);
            });
            
            // Display local video if video call
            if (withVideo && this.localVideo) {
                this.localVideo.srcObject = this.localStream;
                console.log('Set local video srcObject');
            }
            
            // Get the peer ID (assuming single peer for now)
            const peerId = Array.from(this.webrtcHandler.peers.keys())[0];
            if (!peerId) {
                alert('No peer connected');
                this.stopLocalStream();
                return;
            }
            
            // Create call object
            this.currentCall = {
                id: Date.now().toString(),
                peerId: peerId,
                isVideo: withVideo,
                isCaller: true,
                isActive: false
            };
            
            // Send call invitation
            const callInvite = {
                type: 'call-invite',
                callId: this.currentCall.id,
                from: this.userId,
                fromNickname: this.nickname,
                isVideo: withVideo,
                timestamp: Date.now()
            };
            
            this.webrtcHandler.sendMessage(callInvite);
            
            // Show call interface
            this.showCallInterface(true);
            this.updateCallStatus('Calling...');
            
            // DON'T send media offer yet - wait for acceptance
            // Just prepare the peer connection for later
            const pc = this.webrtcHandler.peers.get(peerId);
            if (pc) {
                console.log('=== CALLER: Preparing for call ===');
                console.log('PC signaling state:', pc.signalingState);
                console.log('PC connection state:', pc.connectionState);
                
                // Set up to receive remote tracks when they come
                pc.ontrack = (event) => {
                    console.log('=== CALLER: Received remote track ===');
                    console.log('Track kind:', event.track.kind);
                    console.log('Track id:', event.track.id);
                    console.log('Track enabled:', event.track.enabled);
                    console.log('Streams count:', event.streams.length);
                    this.handleRemoteStream(event.streams[0], targetPeerId);
                };
            }
            
            // Set timeout for call invitation
            setTimeout(() => {
                if (this.currentCall && !this.currentCall.isActive) {
                    this.updateCallStatus('No answer');
                    setTimeout(() => this.endCall(), 2000);
                }
            }, 30000); // 30 seconds timeout
            
        } catch (error) {
            console.error('Failed to start call:', error);
            
            let errorMessage = 'Failed to access camera/microphone.\n\n';
            
            if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
                errorMessage += 'Permission denied.\n\n';
                errorMessage += 'For mobile:\n';
                errorMessage += '1. Check browser permissions in Settings\n';
                errorMessage += '2. Allow camera/microphone for this site\n';
                errorMessage += '3. Refresh the page and try again';
            } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
                errorMessage += 'No camera or microphone found.\n';
                errorMessage += 'Please connect a device and try again.';
            } else if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
                errorMessage += 'Device is already in use.\n';
                errorMessage += 'Close other apps using camera/microphone.';
            } else if (error.name === 'OverconstrainedError') {
                errorMessage += 'Camera/microphone requirements cannot be met.\n';
                errorMessage += 'Trying with basic settings...';
                
                // Try again with basic constraints
                try {
                    const basicConstraints = {
                        audio: true,
                        video: withVideo
                    };
                    this.localStream = await navigator.mediaDevices.getUserMedia(basicConstraints);
                    return; // Success with basic constraints
                } catch (retryError) {
                    errorMessage = 'Failed even with basic settings.';
                }
            } else {
                errorMessage += error.message || 'Unknown error occurred.';
            }
            
            alert(errorMessage);
            this.endCall();
        }
    }
    
    // Handle incoming call
    handleIncomingCall(message) {
        if (this.currentCall) {
            // Already in a call, auto-reject
            this.sendCallResponse(message.from, message.callId, false);
            return;
        }
        
        // Create call object
        this.currentCall = {
            id: message.callId,
            peerId: message.from,
            isVideo: message.isVideo,
            isCaller: false,
            isActive: false
        };
        
        // Show incoming call modal
        this.showIncomingCallModal(message.fromNickname, message.isVideo);
        
        // Play ringtone if available
        this.playRingtone();
    }
    
    // Accept incoming call
    async acceptCall() {
        if (!this.currentCall) return;
        
        try {
            // Hide incoming call modal
            this.hideIncomingCallModal();
            
            // Check if mediaDevices is available
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                throw new Error('Media devices not supported. Please ensure you are using HTTPS.');
            }
            
            // Try with simpler constraints first
            let constraints = {
                audio: true,
                video: this.currentCall.isVideo
            };
            
            console.log('Accepting call with basic constraints:', constraints);
            
            try {
                this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
            } catch (firstError) {
                console.error('Failed with basic constraints:', firstError);
                
                // If video fails, try audio only
                if (this.currentCall.isVideo) {
                    console.log('Trying audio-only fallback...');
                    constraints = { audio: true, video: false };
                    this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
                    this.messageHandler.displaySystemMessage('⚠️ Camera unavailable, using audio only');
                } else {
                    throw firstError;
                }
            }
            
            // Log tracks obtained
            console.log('Got local stream for accept with tracks:');
            this.localStream.getTracks().forEach(track => {
                console.log(`  - ${track.kind}: ${track.label}, enabled: ${track.enabled}, muted: ${track.muted}`);
            });
            
            // Display local video if video call
            if (this.currentCall.isVideo && this.localVideo) {
                this.localVideo.srcObject = this.localStream;
                console.log('Set local video srcObject (accept)');
            }
            
            // Send accept response
            this.sendCallResponse(this.currentCall.peerId, this.currentCall.id, true);
            
            // Store local stream for later use
            const pc = this.webrtcHandler.peers.get(this.currentCall.peerId);
            if (pc) {
                console.log('=== RECEIVER: Ready to receive media offer ===');
                console.log('PC signaling state:', pc.signalingState);
                console.log('PC connection state:', pc.connectionState);
                
                // Setup remote stream handler
                pc.ontrack = (event) => {
                    console.log('=== RECEIVER: Received remote track ===');
                    console.log('Track kind:', event.track.kind);
                    console.log('Track id:', event.track.id);
                    console.log('Track enabled:', event.track.enabled);
                    console.log('Streams count:', event.streams.length);
                    this.handleRemoteStream(event.streams[0], message.from);
                };
                
                // Don't add tracks or create answer yet - wait for media offer
                console.log('Waiting for media offer from caller...');
            }
            
            // Show call interface
            this.showCallInterface(false);
            this.startCallTimer();
            this.currentCall.isActive = true;
            
        } catch (error) {
            console.error('Failed to accept call:', error);
            
            let errorMessage = 'Cannot accept call.\n\n';
            
            if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
                errorMessage += 'Camera/Microphone permission denied.\n\n';
                errorMessage += 'To fix on mobile:\n';
                errorMessage += '1. Go to browser settings\n';
                errorMessage += '2. Site settings > This site\n';
                errorMessage += '3. Allow Camera and Microphone\n';
                errorMessage += '4. Refresh page and try again';
            } else {
                errorMessage += 'Please check:\n';
                errorMessage += '- Camera/mic permissions\n';
                errorMessage += '- No other apps using camera\n';
                errorMessage += '- Using HTTPS (not HTTP)';
            }
            
            alert(errorMessage);
            this.rejectCall();
        }
    }
    
    // Reject incoming call
    rejectCall() {
        if (!this.currentCall) return;
        
        // Hide incoming call modal
        this.hideIncomingCallModal();
        
        // Send reject response
        this.sendCallResponse(this.currentCall.peerId, this.currentCall.id, false);
        
        // Clean up
        this.currentCall = null;
        this.stopRingtone();
    }
    
    // Handle call accepted
    async handleCallAccepted(message) {
        if (!this.currentCall || this.currentCall.id !== message.callId) return;
        
        console.log('=== CALL ACCEPTED - Starting media negotiation ===');
        this.currentCall.isActive = true;
        this.updateCallStatus('Connected');
        this.startCallTimer();
        
        // NOW add media tracks and create offer
        const pc = this.webrtcHandler.peers.get(this.currentCall.peerId);
        if (pc && this.localStream) {
            console.log('Adding local tracks and creating media offer...');
            
            // Add tracks
            this.localStream.getTracks().forEach(track => {
                console.log(`Adding ${track.kind} track to PC`);
                pc.addTrack(track, this.localStream);
            });
            
            // Create offer with media
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            
            // Send media offer
            const mediaOffer = {
                type: 'media-offer', 
                callId: this.currentCall.id,
                offer: {
                    type: offer.type,
                    sdp: offer.sdp
                },
                from: this.userId,
                timestamp: Date.now()
            };
            
            this.webrtcHandler.sendMessage(mediaOffer);
            console.log('Sent media offer after call acceptance');
        }
    }
    
    // Handle call rejected
    handleCallRejected(message) {
        if (!this.currentCall || this.currentCall.id !== message.callId) return;
        
        this.updateCallStatus('Call rejected');
        setTimeout(() => this.endCall(), 2000);
    }
    
    // Handle call ended by peer
    handleCallEnded(message) {
        if (!this.currentCall || this.currentCall.id !== message.callId) return;
        
        this.updateCallStatus('Call ended');
        setTimeout(() => this.endCall(), 1000);
    }
    
    // Handle remote stream
    handleRemoteStream(stream, peerId) {
        console.log('=== HANDLING REMOTE STREAM ===');
        console.log(`Stream for peer: ${peerId}`);
        
        if (!stream) {
            console.error('No stream provided!');
            return;
        }
        
        // Store stream for this peer
        if (!peerId && this.currentCall) {
            peerId = this.currentCall.peerId;
        }
        
        if (!peerId) {
            console.error('No peer ID available for remote stream');
            return;
        }
        
        // Log all tracks in stream
        console.log('Remote stream tracks:');
        stream.getTracks().forEach(track => {
            console.log(`  - ${track.kind}: ${track.id}, enabled: ${track.enabled}, muted: ${track.muted}, readyState: ${track.readyState}`);
        });
        
        // Store stream in map
        this.remoteStreams.set(peerId, stream);
        
        // Use new method to set peer stream
        this.setPeerRemoteStream(peerId, stream);
        
        // Update status
        const audioTracks = stream.getAudioTracks();
        const videoTracks = stream.getVideoTracks();
        console.log(`Audio tracks: ${audioTracks.length}, Video tracks: ${videoTracks.length}`);
        
        // Play the stream
        const elements = this.peerVideoElements.get(peerId);
        if (elements) {
            if (videoTracks.length > 0 && elements.video) {
                elements.video.play().then(() => {
                    console.log(`Remote video playing for ${peerId}`);
                }).catch(err => {
                    console.error(`Error playing remote video for ${peerId}:`, err);
                });
            } else if (audioTracks.length > 0 && elements.audio) {
                elements.audio.play().then(() => {
                    console.log(`Remote audio playing for ${peerId}`);
                }).catch(err => {
                    console.error(`Error playing remote audio for ${peerId}:`, err);
                });
            }
        }
    }
    
    // End call
    endCall() {
        if (!this.currentCall) return;
        
        // Send end call message
        if (this.currentCall.isActive) {
            const endMessage = {
                type: 'call-end',
                callId: this.currentCall.id,
                from: this.userId,
                timestamp: Date.now()
            };
            this.webrtcHandler.sendMessage(endMessage);
        }
        
        // Stop streams
        this.stopLocalStream();
        this.stopRemoteStream();
        
        // Remove tracks from peer connection
        const pc = this.webrtcHandler.peers.get(this.currentCall.peerId);
        if (pc) {
            const senders = pc.getSenders();
            senders.forEach(sender => {
                if (sender.track) {
                    pc.removeTrack(sender);
                }
            });
            pc.ontrack = null;
        }
        
        // Hide call interface
        this.hideCallInterface();
        
        // Stop call timer
        this.stopCallTimer();
        
        // Clean up
        this.currentCall = null;
        this.updateCallStatus('');
        
        // Reset buttons
        this.muteBtn?.classList.remove('muted');
        this.videoToggleBtn?.classList.remove('disabled');
    }
    
    // Toggle mute
    toggleMute() {
        if (!this.localStream) return;
        
        const audioTracks = this.localStream.getAudioTracks();
        audioTracks.forEach(track => {
            track.enabled = !track.enabled;
        });
        
        this.muteBtn?.classList.toggle('muted');
    }
    
    // Toggle video
    toggleVideo() {
        if (!this.localStream) return;
        
        const videoTracks = this.localStream.getVideoTracks();
        videoTracks.forEach(track => {
            track.enabled = !track.enabled;
        });
        
        this.videoToggleBtn?.classList.toggle('disabled');
        
        // Show/hide local video
        if (this.localVideo) {
            this.localVideo.style.opacity = videoTracks[0]?.enabled ? '1' : '0.3';
        }
    }
    
    // Send call response
    sendCallResponse(peerId, callId, accepted) {
        const response = {
            type: accepted ? 'call-accept' : 'call-reject',
            callId: callId,
            from: this.userId,
            fromNickname: this.nickname,
            timestamp: Date.now()
        };
        this.webrtcHandler.sendMessage(response);
    }
    
    // Show call interface
    showCallInterface(isCaller) {
        if (this.callInterface) {
            this.callInterface.style.display = 'block';
        }
        
        // Hide/show video elements based on call type
        if (!this.currentCall?.isVideo) {
            if (this.localVideo) this.localVideo.parentElement.style.display = 'none';
            // Hide videos grid for audio-only calls
            if (this.videosGrid) {
                this.videosGrid.style.display = 'none';
            }
            if (this.videoToggleBtn) this.videoToggleBtn.style.display = 'none';
        } else {
            if (this.localVideo) this.localVideo.parentElement.style.display = 'block';
            // Show videos grid for video calls
            if (this.videosGrid) {
                this.videosGrid.style.display = 'grid';
            }
            if (this.videoToggleBtn) this.videoToggleBtn.style.display = 'flex';
        }
    }
    
    // Hide call interface
    hideCallInterface() {
        if (this.callInterface) {
            this.callInterface.style.display = 'none';
        }
    }
    
    // Show incoming call modal
    showIncomingCallModal(callerName, isVideo) {
        if (this.incomingCallModal) {
            this.incomingCallModal.style.display = 'flex';
        }
        if (this.callerName) {
            this.callerName.textContent = `${callerName} - ${isVideo ? 'Video' : 'Audio'} Call`;
        }
    }
    
    // Hide incoming call modal
    hideIncomingCallModal() {
        if (this.incomingCallModal) {
            this.incomingCallModal.style.display = 'none';
        }
        this.stopRingtone();
    }
    
    // Update call status
    updateCallStatus(status) {
        if (this.callStatus) {
            this.callStatus.textContent = status;
        }
    }
    
    // Start call timer
    startCallTimer() {
        this.callStartTime = Date.now();
        this.callTimer = setInterval(() => {
            const duration = Math.floor((Date.now() - this.callStartTime) / 1000);
            const minutes = Math.floor(duration / 60);
            const seconds = duration % 60;
            if (this.callTimer) {
                document.getElementById('callTimer').textContent = 
                    `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
            }
        }, 1000);
    }
    
    // Stop call timer
    stopCallTimer() {
        if (this.callTimer) {
            clearInterval(this.callTimer);
            this.callTimer = null;
        }
        if (document.getElementById('callTimer')) {
            document.getElementById('callTimer').textContent = '00:00';
        }
    }
    
    // Stop local stream
    stopLocalStream() {
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
            this.localStream = null;
        }
        if (this.localVideo) {
            this.localVideo.srcObject = null;
        }
    }
    
    // Stop remote stream
    stopRemoteStream() {
        // Stop all remote streams
        this.remoteStreams.forEach((stream, peerId) => {
            stream.getTracks().forEach(track => track.stop());
            this.removePeerVideoElement(peerId);
        });
        this.remoteStreams.clear();
        
        // Clear the grid but keep the call info
        if (this.videosGrid) {
            const callInfo = this.videosGrid.querySelector('.call-info');
            this.videosGrid.innerHTML = '';
            if (callInfo) {
                this.videosGrid.appendChild(callInfo);
            }
        }
    }
    
    // Play ringtone (placeholder)
    playRingtone() {
        // Could add audio element for ringtone
        console.log('🔔 Incoming call...');
    }
    
    // Stop ringtone
    stopRingtone() {
        // Stop ringtone if implemented
    }
    
    // Handle message
    handleMessage(message) {
        switch (message.type) {
            case 'call-invite':
                this.handleIncomingCall(message);
                break;
            case 'call-accept':
                this.handleCallAccepted(message);
                break;
            case 'call-reject':
                this.handleCallRejected(message);
                break;
            case 'call-end':
                this.handleCallEnded(message);
                break;
            case 'media-offer':
                this.handleMediaOffer(message);
                break;
            case 'media-answer':
                this.handleMediaAnswer(message);
                break;
        }
    }
    
    // Handle media offer (renegotiation for media tracks)
    async handleMediaOffer(message) {
        console.log('=== HANDLE MEDIA OFFER ===');
        if (!this.currentCall || this.currentCall.id !== message.callId) {
            console.log('No current call or call ID mismatch');
            return;
        }
        
        const pc = this.webrtcHandler.peers.get(message.from);
        console.log('Peer connection exists?', !!pc);
        console.log('Offer exists?', !!message.offer);
        
        if (pc && message.offer && this.localStream) {
            try {
                // Add local tracks BEFORE creating answer
                console.log('Adding local tracks before creating answer...');
                this.localStream.getTracks().forEach(track => {
                    console.log(`Adding ${track.kind} track to PC (receiver)`);
                    pc.addTrack(track, this.localStream);
                });
                
                console.log('PC signaling state before setting offer:', pc.signalingState);
                console.log('Setting remote description (offer)...');
                await pc.setRemoteDescription(new RTCSessionDescription(message.offer));
                console.log('PC signaling state after setting offer:', pc.signalingState);
                
                // Create answer with our tracks
                console.log('Creating answer with local tracks...');
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                
                // Send answer back
                const mediaAnswer = {
                    type: 'media-answer',
                    callId: this.currentCall.id,
                    answer: {
                        type: answer.type,
                        sdp: answer.sdp
                    },
                    from: this.userId,
                    timestamp: Date.now()
                };
                
                this.webrtcHandler.sendMessage(mediaAnswer);
                console.log('Sent media answer');
            } catch (error) {
                console.error('Error handling media offer:', error);
            }
        }
    }
    
    // Handle media answer
    async handleMediaAnswer(message) {
        console.log('=== HANDLE MEDIA ANSWER ===');
        if (!this.currentCall || this.currentCall.id !== message.callId) {
            console.log('No current call or call ID mismatch');
            return;
        }
        
        const pc = this.webrtcHandler.peers.get(message.from);
        console.log('Peer connection exists?', !!pc);
        console.log('Answer exists?', !!message.answer);
        
        if (pc && message.answer) {
            try {
                console.log('PC signaling state before setting answer:', pc.signalingState);
                console.log('Setting remote description (answer)...');
                await pc.setRemoteDescription(new RTCSessionDescription(message.answer));
                console.log('PC signaling state after setting answer:', pc.signalingState);
                console.log('Media answer processed successfully');
                
                // Check if we have remote streams
                const receivers = pc.getReceivers();
                console.log('PC receivers count:', receivers.length);
                receivers.forEach(receiver => {
                    console.log(`  Receiver track: ${receiver.track?.kind}, enabled: ${receiver.track?.enabled}`);
                });
            } catch (error) {
                console.error('Error handling media answer:', error);
            }
        }
    }
    
    // Create video element for a peer
    createPeerVideoElement(peerId, peerNickname) {
        // Check if element already exists
        if (this.peerVideoElements.has(peerId)) {
            return this.peerVideoElements.get(peerId);
        }
        
        // Create container
        const container = document.createElement('div');
        container.className = 'peer-video-container';
        container.id = `peer-video-${peerId}`;
        
        // Create video element
        const video = document.createElement('video');
        video.autoplay = true;
        video.playsinline = true;
        video.id = `video-${peerId}`;
        
        // Create audio element (for audio-only calls)
        const audio = document.createElement('audio');
        audio.autoplay = true;
        audio.id = `audio-${peerId}`;
        
        // Create label
        const label = document.createElement('div');
        label.className = 'peer-video-label';
        label.textContent = peerNickname || 'Peer';
        
        // Append elements
        container.appendChild(video);
        container.appendChild(audio);
        container.appendChild(label);
        
        // Add to grid
        if (this.videosGrid) {
            this.videosGrid.appendChild(container);
            this.updateVideoGridLayout();
        }
        
        // Store references
        this.peerVideoElements.set(peerId, {
            container: container,
            video: video,
            audio: audio,
            label: label
        });
        
        return this.peerVideoElements.get(peerId);
    }
    
    // Remove video element for a peer
    removePeerVideoElement(peerId) {
        const elements = this.peerVideoElements.get(peerId);
        if (elements) {
            // Stop tracks
            if (elements.video.srcObject) {
                elements.video.srcObject.getTracks().forEach(track => track.stop());
            }
            if (elements.audio.srcObject) {
                elements.audio.srcObject.getTracks().forEach(track => track.stop());
            }
            
            // Remove from DOM
            elements.container.remove();
            
            // Remove from map
            this.peerVideoElements.delete(peerId);
            
            // Update layout
            this.updateVideoGridLayout();
        }
    }
    
    // Update video grid layout based on number of participants
    updateVideoGridLayout() {
        if (!this.videosGrid) return;
        
        const participantCount = this.peerVideoElements.size;
        
        // Remove all participant classes
        this.videosGrid.classList.remove(
            'participants-1', 'participants-2', 'participants-3',
            'participants-4', 'participants-5', 'participants-6'
        );
        
        // Add appropriate class
        if (participantCount <= 6) {
            this.videosGrid.classList.add(`participants-${participantCount}`);
        }
    }
    
    // Set remote stream for a specific peer
    setPeerRemoteStream(peerId, stream) {
        const elements = this.peerVideoElements.get(peerId);
        if (!elements) {
            // Create element if it doesn't exist
            const peerNickname = window.chatApp?.peerNicknames?.get(peerId) || 'Peer';
            this.createPeerVideoElement(peerId, peerNickname);
            elements = this.peerVideoElements.get(peerId);
        }
        
        if (elements) {
            // Check if stream has video tracks
            const videoTracks = stream.getVideoTracks();
            const audioTracks = stream.getAudioTracks();
            
            if (videoTracks.length > 0) {
                // Video call
                elements.video.srcObject = stream;
                elements.video.style.display = 'block';
                elements.audio.style.display = 'none';
            } else if (audioTracks.length > 0) {
                // Audio-only call
                elements.audio.srcObject = stream;
                elements.video.style.display = 'none';
                // Could show an avatar or placeholder for audio-only
            }
        }
    }
    
    // Cleanup call handler
    cleanup() {
        // End any active call
        if (this.currentCall) {
            this.endCall();
        }
        
        // Stop all streams
        this.stopLocalStream();
        this.stopRemoteStream();
        
        // Clear all peer video elements
        this.peerVideoElements.forEach((elements, peerId) => {
            this.removePeerVideoElement(peerId);
        });
        this.peerVideoElements.clear();
        
        // Reset state
        this.currentCall = null;
        this.localStream = null;
        this.remoteStreams.clear();
        this.activePeers.clear();
        
        // Stop timer
        this.stopCallTimer();
        
        // Hide interfaces
        this.hideCallInterface();
        this.hideIncomingCallModal();
    }
}

// Export
window.CallHandler = CallHandler;