// Group Call Handler for multi-participant audio calls (up to 4 people)
class GroupCallHandler {
    constructor(webrtcHandler, userId, nickname) {
        this.webrtcHandler = webrtcHandler;
        this.userId = userId;
        this.nickname = nickname;

        // Group call state
        this.currentGroupCall = null;
        this.localStream = null;
        this.maxParticipants = 4;

        // Participant management
        this.participants = new Map(); // peerId -> {nickname, stream, audioElement, isMuted, isSpeaking, pc}
        this.callConnections = new Map(); // peerId -> RTCPeerConnection for this call

        // Voice activity detection
        this.audioContexts = new Map(); // peerId -> AudioContext for voice detection
        this.speakingThreshold = 30; // Adjust based on testing

        // UI elements
        this.groupCallInterface = null;
        this.participantsGrid = null;

        // Bind methods
        this.handleGroupCallInvite = this.handleGroupCallInvite.bind(this);
        this.handleGroupCallAccept = this.handleGroupCallAccept.bind(this);
        this.handleGroupCallReject = this.handleGroupCallReject.bind(this);
        this.handleParticipantJoined = this.handleParticipantJoined.bind(this);
        this.handleParticipantLeft = this.handleParticipantLeft.bind(this);
        this.handleGroupCallEnd = this.handleGroupCallEnd.bind(this);
        this.toggleMute = this.toggleMute.bind(this);  // Bind toggleMute
    }

    // Initialize group call UI
    initializeUI() {
        // Get or create group call interface elements
        this.groupCallInterface = document.getElementById('groupCallInterface');
        if (!this.groupCallInterface) {
            this.createGroupCallUI();
        }

        this.participantsGrid = document.getElementById('participantsGrid');

        // Get the group call button from header
        this.groupCallBtn = document.getElementById('groupCallBtn');

        this.setupEventListeners();
    }

    // Create group call UI dynamically
    createGroupCallUI() {
        const callUI = document.createElement('div');
        callUI.id = 'groupCallInterface';
        callUI.className = 'group-call-interface';
        callUI.style.display = 'none';

        callUI.innerHTML = `
            <div class="group-call-container">
                <div class="call-header">
                    <h3>Group Audio Call</h3>
                    <div class="call-timer" id="groupCallTimer">00:00</div>
                </div>

                <div class="participants-grid" id="participantsGrid">
                    <!-- Participant cards will be added here dynamically -->
                </div>

                <div class="call-controls">
                    <button class="control-btn mute-btn" id="groupMuteBtn" title="Mute/Unmute">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
                            <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                        </svg>
                    </button>

                    <button class="control-btn end-call-btn" id="groupEndCallBtn" title="End Call">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M23 7l-7 5 7 5V7z"></path>
                            <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
                        </svg>
                    </button>

                    <button class="control-btn add-participant-btn" id="addParticipantBtn" title="Add Participant">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                            <circle cx="8.5" cy="7" r="4"></circle>
                            <line x1="20" y1="8" x2="20" y2="14"></line>
                            <line x1="23" y1="11" x2="17" y2="11"></line>
                        </svg>
                    </button>
                </div>
            </div>
        `;

        // Insert after regular call interface
        const regularCallInterface = document.getElementById('callInterface');
        if (regularCallInterface) {
            regularCallInterface.parentNode.insertBefore(callUI, regularCallInterface.nextSibling);
        } else {
            document.body.appendChild(callUI);
        }

        this.groupCallInterface = callUI;
    }

    // Setup event listeners
    setupEventListeners() {
        // Main group call button in header
        if (this.groupCallBtn) {
            this.groupCallBtn.addEventListener('click', () => {
                console.log('[GroupCall] Group call button clicked');
                this.startGroupCall();
            });
        }

        // Note: Group call interface controls are set up in showGroupCallInterface()
        // to ensure they exist when we attach listeners
    }

    // Start a group call (audio or video)
    async startGroupCall(selectedPeerIds = [], withVideo = false) {
        if (this.currentGroupCall) {
            console.log('Already in a group call');
            return;
        }

        // Get all available peers
        const availablePeers = Array.from(window.chatApp?.peers || []);

        if (availablePeers.length === 0) {
            alert('No peers available for group call');
            return;
        }

        // If no peers selected, show selection dialog
        if (selectedPeerIds.length === 0) {
            selectedPeerIds = await this.selectParticipants(availablePeers);
            if (!selectedPeerIds || selectedPeerIds.length === 0) {
                return; // User cancelled
            }
        }

        // Limit to max participants (3 others + self = 4 total)
        if (selectedPeerIds.length > this.maxParticipants - 1) {
            selectedPeerIds = selectedPeerIds.slice(0, this.maxParticipants - 1);
            alert(`Group calls are limited to ${this.maxParticipants} participants total`);
        }

        try {
            // Get local stream (audio and optionally video)
            const constraints = {
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    sampleRate: 16000,
                    channelCount: 1
                }
            };

            // Add video constraints if video call
            if (withVideo) {
                constraints.video = {
                    width: { ideal: 640 },
                    height: { ideal: 480 },
                    frameRate: { ideal: 30 }
                };
            }

            this.localStream = await navigator.mediaDevices.getUserMedia(constraints);

            // Create group call object (include self in participants)
            const allParticipants = new Set([this.userId, ...selectedPeerIds]);
            this.currentGroupCall = {
                id: 'group-' + Date.now(),
                initiator: this.userId,
                participants: allParticipants,
                startTime: Date.now(),
                isActive: true,
                isVideo: withVideo
            };

            // Add self to participants display
            this.addParticipantCard(this.userId, this.nickname, true);

            // Send group call invitations
            const inviteMessage = {
                type: 'group-call-invite',
                callId: this.currentGroupCall.id,
                from: this.userId,
                fromNickname: this.nickname,
                participants: Array.from(this.currentGroupCall.participants),
                isVideo: withVideo,
                timestamp: Date.now()
            };

            // Send invite to each selected peer
            // IMPORTANT: Include ALL participants in the invite so everyone knows who's in the call
            selectedPeerIds.forEach(peerId => {
                // Send targeted message to specific peer with full participant list
                this.webrtcHandler.sendMessage({
                    ...inviteMessage,
                    to: peerId
                });
                console.log(`[GroupCall] Sent invite to ${peerId} with participants:`, inviteMessage.participants);
            });

            // Show group call interface
            this.showGroupCallInterface();
            this.updateCallStatus('Calling participants...');
            this.startCallTimer();

            // Set default audio output for group call (speaker)
            if (window.audioOutputManager) {
                // Register the local stream
                window.audioOutputManager.registerStream(this.localStream);
                // Default to speaker for group calls
                await window.audioOutputManager.setDefaultForCallType(true);
            }

            // Set timeout for responses
            setTimeout(() => {
                if (this.participants.size === 0) {
                    this.updateCallStatus('No one joined');
                    setTimeout(() => this.endGroupCall(), 2000);
                }
            }, 30000);

        } catch (error) {
            console.error('Failed to start group call:', error);
            alert('Failed to access microphone. Please check permissions.');
            this.endGroupCall();
        }
    }

    // Select participants for group call
    async selectParticipants(availablePeers) {
        return new Promise((resolve) => {
            const modal = document.createElement('div');
            modal.className = 'participant-selection-modal';
            modal.innerHTML = `
                <div class="modal-content">
                    <h3>Select Participants for Group Call</h3>
                    <p>Maximum ${this.maxParticipants - 1} participants</p>
                    <div class="participant-list">
                        ${availablePeers.map(peerId => {
                            const nickname = window.chatApp?.peerNicknames?.get(peerId) || 'Unknown';
                            return `
                                <label class="participant-option">
                                    <input type="checkbox" value="${peerId}" />
                                    <span>${nickname}</span>
                                </label>
                            `;
                        }).join('')}
                    </div>
                    <div class="modal-actions">
                        <button id="startGroupCallBtn">Start Call</button>
                        <button id="cancelGroupCallBtn">Cancel</button>
                    </div>
                </div>
            `;

            document.body.appendChild(modal);

            document.getElementById('startGroupCallBtn').onclick = () => {
                const selected = Array.from(modal.querySelectorAll('input:checked'))
                    .map(input => input.value);
                document.body.removeChild(modal);
                resolve(selected);
            };

            document.getElementById('cancelGroupCallBtn').onclick = () => {
                document.body.removeChild(modal);
                resolve(null);
            };
        });
    }

    // Handle incoming group call invite
    async handleGroupCallInvite(message) {
        // Check if invite is for us
        if (message.to && message.to !== this.userId) return;

        if (this.currentGroupCall) {
            // Already in a call, auto-reject
            this.sendGroupCallResponse(message.from, message.callId, false);
            return;
        }

        // Show incoming call dialog
        const callType = message.isVideo ? 'video' : 'audio';
        const accept = confirm(`${message.fromNickname} is inviting you to a group ${callType} call with ${message.participants.length} people. Accept?`);

        if (accept) {
            await this.acceptGroupCall(message);
        } else {
            this.rejectGroupCall(message);
        }
    }

    // Accept group call
    async acceptGroupCall(message) {
        try {
            // Get local stream (audio and optionally video)
            const constraints = {
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    sampleRate: 16000,
                    channelCount: 1
                }
            };

            // Add video constraints if video call
            if (message.isVideo) {
                constraints.video = {
                    width: { ideal: 640 },
                    height: { ideal: 480 },
                    frameRate: { ideal: 30 }
                };
            }

            this.localStream = await navigator.mediaDevices.getUserMedia(constraints);

            // Create group call object with ALL participants (including initiator)
            const allParticipants = new Set([...message.participants, message.from]);
            this.currentGroupCall = {
                id: message.callId,
                initiator: message.from,
                participants: allParticipants,
                startTime: Date.now(),
                isActive: true,
                isVideo: message.isVideo
            };

            // Send acceptance to initiator
            this.sendGroupCallResponse(message.from, message.callId, true);

            // Broadcast to all peers that we joined (they'll filter if needed)
            this.webrtcHandler.sendMessage({
                type: 'group-call-participant-joined',
                callId: message.callId,
                from: this.userId,
                fromNickname: this.nickname,
                timestamp: Date.now()
            });

            // Show interface
            this.showGroupCallInterface();
            this.startCallTimer();

            // Add self to display
            this.addParticipantCard(this.userId, this.nickname, true);

            // Set default audio output for group call (speaker)
            if (window.audioOutputManager) {
                // Register the local stream
                window.audioOutputManager.registerStream(this.localStream);
                // Default to speaker for group calls
                await window.audioOutputManager.setDefaultForCallType(true);
            }

            // Connect to ALL existing participants in the call
            console.log(`[GroupCall] Connecting to all participants in the call:`, message.participants);

            // Connect to each participant (including initiator)
            for (const peerId of message.participants) {
                if (peerId !== this.userId) {
                    console.log(`[GroupCall] Checking connection with ${peerId}`);

                    // Determine who initiates based on ID comparison
                    const shouldInitiate = this.userId < peerId;
                    console.log(`[GroupCall] Connection with ${peerId}: shouldInitiate=${shouldInitiate} (myId: ${this.userId})`);

                    if (shouldInitiate) {
                        // Initiate connection immediately
                        console.log(`[GroupCall] Initiating connection to ${peerId}`);
                        await this.connectToParticipant(peerId, true);
                    } else {
                        // The other peer will initiate
                        console.log(`[GroupCall] Waiting for ${peerId} to initiate connection`);
                    }
                }
            }

        } catch (error) {
            console.error('Failed to accept group call:', error);
            alert('Failed to join group call');
            this.endGroupCall();
        }
    }

    // Connect to a specific participant
    async connectToParticipant(peerId, createOffer = false) {
        console.log(`[GroupCall] Connecting to participant ${peerId}, createOffer: ${createOffer}, myId: ${this.userId}`);

        // Create new peer connection for this participant
        const pc = new RTCPeerConnection({
            iceServers: CONFIG.ICE_SERVERS
        });

        // Store connection
        this.callConnections.set(peerId, pc);

        // Add local stream
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => {
                pc.addTrack(track, this.localStream);
            });
        }

        // Handle remote stream
        pc.ontrack = (event) => {
            console.log(`Received stream from ${peerId}`);
            this.handleParticipantStream(peerId, event.streams[0]);
        };

        // Handle ICE candidates
        pc.onicecandidate = (event) => {
            if (event.candidate) {
                this.webrtcHandler.sendMessage({
                    type: 'group-call-ice',
                    callId: this.currentGroupCall.id,
                    candidate: event.candidate,
                    from: this.userId,
                    to: peerId,
                    timestamp: Date.now()
                });
            }
        };

        // Create offer if needed
        if (createOffer) {
            console.log(`[GroupCall] Creating offer for ${peerId}`);
            try {
                const offer = await pc.createOffer({
                    offerToReceiveAudio: true,
                    offerToReceiveVideo: false
                });
                await pc.setLocalDescription(offer);

                console.log(`[GroupCall] Sending offer to ${peerId}`);
                this.webrtcHandler.sendMessage({
                    type: 'group-call-offer',
                    callId: this.currentGroupCall.id,
                    offer: offer,
                    from: this.userId,
                    to: peerId,
                    timestamp: Date.now()
                });
            } catch (error) {
                console.error(`[GroupCall] Error creating offer for ${peerId}:`, error);
            }
        }

        return pc;
    }

    // Handle participant stream
    handleParticipantStream(peerId, stream) {
        const nickname = window.chatApp?.peerNicknames?.get(peerId) || 'Participant';

        // Check if this is a video call
        const hasVideo = stream.getVideoTracks().length > 0;

        if (hasVideo && this.currentGroupCall?.isVideo) {
            // For video calls, set the stream directly to the video element
            const video = document.getElementById(`video-${peerId}`);
            if (video) {
                video.srcObject = stream;
            }
        }

        // Always create audio element for audio routing
        const audio = document.createElement('audio');
        audio.id = `group-audio-${peerId}`;
        audio.srcObject = stream;
        audio.autoplay = true;
        audio.style.display = 'none'; // Hide audio element
        document.body.appendChild(audio);

        // Register with audio output manager
        if (window.audioOutputManager) {
            // Register both the stream and audio element
            window.audioOutputManager.registerStream(stream);
            window.audioOutputManager.registerAudioElement(audio);
        }

        // Store participant info
        this.participants.set(peerId, {
            nickname: nickname,
            stream: stream,
            audioElement: audio,
            videoElement: hasVideo ? document.getElementById(`video-${peerId}`) : null,
            isMuted: false,
            isSpeaking: false,
            pc: this.callConnections.get(peerId)
        });

        // Add participant card to UI
        this.addParticipantCard(peerId, nickname);

        // Setup voice activity detection for audio-only calls
        if (!hasVideo) {
            this.setupVoiceActivityDetection(peerId, stream);
        }

        // Update status
        this.updateCallStatus(`${this.participants.size + 1} participants`);
    }

    // Add participant card to UI
    addParticipantCard(peerId, nickname, isSelf = false) {
        if (!this.participantsGrid) return;

        // Check if card already exists
        if (document.getElementById(`participant-${peerId}`)) return;

        const card = document.createElement('div');
        card.className = 'participant-card';
        card.id = `participant-${peerId}`;

        // For video calls, add video element
        if (this.currentGroupCall?.isVideo) {
            card.innerHTML = `
                <div class="participant-video-container">
                    <video id="video-${peerId}" autoplay playsinline ${isSelf ? 'muted' : ''}></video>
                    <div class="participant-name-overlay">
                        ${nickname} ${isSelf ? '(You)' : ''}
                    </div>
                    <div class="participant-indicators">
                        <span class="muted-indicator" id="muted-${peerId}" style="display: none;">🔇</span>
                    </div>
                </div>`;

            // Set local video if self
            if (isSelf && this.localStream) {
                setTimeout(() => {
                    const video = document.getElementById(`video-${peerId}`);
                    if (video) {
                        video.srcObject = this.localStream;
                    }
                }, 100);
            }
        } else {
            // Audio-only card
            card.innerHTML = `
                <div class="participant-avatar ${isSelf ? 'self' : ''}">
                    ${nickname.charAt(0).toUpperCase()}
                </div>
                <div class="participant-name">
                    ${nickname} ${isSelf ? '(You)' : ''}
                </div>
                <div class="participant-indicators">
                    <span class="speaking-indicator" id="speaking-${peerId}">🔊</span>
                    <span class="muted-indicator" id="muted-${peerId}" style="display: none;">🔇</span>
                </div>`;
        }

        this.participantsGrid.appendChild(card);
        this.updateGridLayout();
    }

    // Setup voice activity detection
    setupVoiceActivityDetection(peerId, stream) {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const analyser = audioContext.createAnalyser();
        const microphone = audioContext.createMediaStreamSource(stream);
        const scriptProcessor = audioContext.createScriptProcessor(2048, 1, 1);

        analyser.smoothingTimeConstant = 0.8;
        analyser.fftSize = 1024;

        microphone.connect(analyser);
        analyser.connect(scriptProcessor);
        scriptProcessor.connect(audioContext.destination);

        scriptProcessor.onaudioprocess = () => {
            const array = new Uint8Array(analyser.frequencyBinCount);
            analyser.getByteFrequencyData(array);
            const average = array.reduce((a, b) => a + b) / array.length;

            const isSpeaking = average > this.speakingThreshold;
            this.updateSpeakingIndicator(peerId, isSpeaking);
        };

        this.audioContexts.set(peerId, { audioContext, analyser, scriptProcessor });
    }

    // Update speaking indicator
    updateSpeakingIndicator(peerId, isSpeaking) {
        const indicator = document.getElementById(`speaking-${peerId}`);
        if (indicator) {
            indicator.style.display = isSpeaking ? 'inline' : 'none';
        }

        const participant = this.participants.get(peerId);
        if (participant) {
            participant.isSpeaking = isSpeaking;
        }
    }

    // Update grid layout based on participant count
    updateGridLayout() {
        if (!this.participantsGrid) return;

        const count = this.participantsGrid.children.length;
        const baseClass = 'participants-grid';
        const videoClass = this.currentGroupCall?.isVideo ? ' video-grid' : '';
        this.participantsGrid.className = `${baseClass}${videoClass} participants-${Math.min(count, 4)}`;
    }

    // Toggle mute
    toggleMute() {
        console.log('[GroupCall] toggleMute called');
        console.log('[GroupCall] localStream exists:', !!this.localStream);
        console.log('[GroupCall] currentGroupCall:', this.currentGroupCall);

        if (!this.localStream) {
            console.error('[GroupCall] Cannot toggle mute - no local stream');
            alert('Cannot toggle mute - no local audio stream');
            return;
        }

        const audioTracks = this.localStream.getAudioTracks();
        console.log('[GroupCall] Audio tracks count:', audioTracks.length);

        if (audioTracks.length === 0) {
            console.error('[GroupCall] No audio tracks in stream');
            alert('No audio tracks found');
            return;
        }

        const audioTrack = audioTracks[0];
        const wasEnabled = audioTrack.enabled;
        audioTrack.enabled = !wasEnabled;
        const isNowMuted = !audioTrack.enabled;

        console.log(`[GroupCall] Toggled mute: was ${wasEnabled ? 'unmuted' : 'muted'}, now ${isNowMuted ? 'muted' : 'unmuted'}`);
        console.log('[GroupCall] Track enabled state:', audioTrack.enabled);

        const muteBtn = document.getElementById('groupMuteBtn');
        if (muteBtn) {
            muteBtn.classList.toggle('muted', isNowMuted);
            muteBtn.title = isNowMuted ? 'Unmute' : 'Mute';
            console.log('[GroupCall] Updated button UI');
        } else {
            console.error('[GroupCall] Mute button not found for UI update');
        }

        // Update own muted indicator
        const indicator = document.getElementById(`muted-${this.userId}`);
        if (indicator) {
            indicator.style.display = isNowMuted ? 'inline' : 'none';
        }

        // Notify other participants
        if (this.currentGroupCall) {
            this.broadcastToCall({
                type: 'group-call-mute-status',
                callId: this.currentGroupCall.id,
                from: this.userId,
                isMuted: isNowMuted,
                timestamp: Date.now()
            });
        }

        // Mic toggle notifications removed per user request
    }

    // Toggle video
    toggleVideo() {
        if (!this.localStream) {
            console.warn('[GroupCall] Cannot toggle video - no local stream');
            return;
        }

        const videoTrack = this.localStream.getVideoTracks()[0];
        if (videoTrack) {
            videoTrack.enabled = !videoTrack.enabled;
            const videoBtn = document.getElementById('groupVideoToggleBtn');
            if (videoBtn) {
                videoBtn.classList.toggle('disabled', !videoTrack.enabled);
                videoBtn.title = videoTrack.enabled ? 'Disable Video' : 'Enable Video';
            }
            console.log(`[GroupCall] Video ${videoTrack.enabled ? 'enabled' : 'disabled'}`);
        } else {
            console.error('[GroupCall] No video track in local stream');
        }
    }

    // Broadcast message to all call participants
    broadcastToCall(message) {
        if (!this.currentGroupCall) return;

        this.currentGroupCall.participants.forEach(peerId => {
            if (peerId !== this.userId) {
                this.webrtcHandler.sendMessage(message, peerId);
            }
        });
    }

    // Show group call interface
    showGroupCallInterface() {
        if (!this.groupCallInterface) {
            this.initializeUI();
        }

        if (this.groupCallInterface) {
            this.groupCallInterface.style.display = 'block';

            // Re-setup event listeners when showing interface
            // Try both possible IDs for the end call button
            const endCallBtn = document.getElementById('endGroupCallBtn') || document.getElementById('groupEndCallBtn');
            if (endCallBtn && !endCallBtn.hasAttribute('data-listener-attached')) {
                endCallBtn.addEventListener('click', () => {
                    console.log('[GroupCall] End call button clicked from interface');
                    this.endGroupCall();
                });
                endCallBtn.setAttribute('data-listener-attached', 'true');
            }

            // Mute button - remove old listener and add new one
            const muteBtn = document.getElementById('groupMuteBtn');
            if (muteBtn) {
                // Remove any existing listener first by cloning
                const newMuteBtn = muteBtn.cloneNode(true);
                muteBtn.parentNode.replaceChild(newMuteBtn, muteBtn);

                // Store reference to handler for debugging
                const handler = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    console.log('[GroupCall] Mute button clicked');
                    console.log('[GroupCall] Handler this:', this);
                    console.log('[GroupCall] Handler has toggleMute:', typeof this.toggleMute);

                    if (this.toggleMute) {
                        this.toggleMute();
                    } else {
                        console.error('[GroupCall] toggleMute method not found!');
                    }
                };

                // Add new listener
                newMuteBtn.addEventListener('click', handler);
                console.log('[GroupCall] Mute button listener attached to element:', newMuteBtn);
            } else {
                console.error('[GroupCall] Mute button not found in DOM');
            }

            // Video toggle button (for video calls only)
            const videoToggleBtn = document.getElementById('groupVideoToggleBtn');
            if (videoToggleBtn) {
                if (this.currentGroupCall?.isVideo) {
                    videoToggleBtn.style.display = 'inline-flex';
                    const newVideoBtn = videoToggleBtn.cloneNode(true);
                    videoToggleBtn.parentNode.replaceChild(newVideoBtn, videoToggleBtn);
                    newVideoBtn.addEventListener('click', () => {
                        this.toggleVideo();
                    });
                } else {
                    videoToggleBtn.style.display = 'none';
                }
            }

            // Audio output button
            const audioOutputBtn = document.getElementById('groupAudioOutputBtn');
            if (audioOutputBtn && !audioOutputBtn.hasAttribute('data-listener-attached')) {
                audioOutputBtn.addEventListener('click', async () => {
                    if (window.audioOutputManager) {
                        await window.audioOutputManager.switchOutput();
                    }
                });
                audioOutputBtn.setAttribute('data-listener-attached', 'true');
            }
        }

        // Hide regular call interface if shown
        const regularInterface = document.getElementById('callInterface');
        if (regularInterface) {
            regularInterface.style.display = 'none';
        }
    }

    // Hide group call interface
    hideGroupCallInterface() {
        if (this.groupCallInterface) {
            this.groupCallInterface.style.display = 'none';
        }
    }

    // Update call status
    updateCallStatus(status) {
        const statusEl = document.querySelector('.group-call-status');
        if (statusEl) {
            statusEl.textContent = status;
        }
    }

    // Start call timer
    startCallTimer() {
        this.callStartTime = Date.now();
        this.callTimer = setInterval(() => {
            const duration = Math.floor((Date.now() - this.callStartTime) / 1000);
            const minutes = Math.floor(duration / 60);
            const seconds = duration % 60;
            const timerEl = document.getElementById('groupCallTimer');
            if (timerEl) {
                timerEl.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
            }
        }, 1000);
    }

    // Stop call timer
    stopCallTimer() {
        if (this.callTimer) {
            clearInterval(this.callTimer);
            this.callTimer = null;
        }
    }

    // End group call
    endGroupCall() {
        if (!this.currentGroupCall) return;

        // Notify all participants
        this.broadcastToCall({
            type: 'group-call-end',
            callId: this.currentGroupCall.id,
            from: this.userId,
            timestamp: Date.now()
        });

        // Clean up
        this.cleanup();
    }

    // Enable the group call button
    enableCallButton() {
        if (this.groupCallBtn) {
            this.groupCallBtn.disabled = false;
        }
    }

    // Show participant selection modal
    showParticipantSelection() {
        if (!this.participantSelectionModal || !this.participantList) return;

        // Get connected peers from the app
        const connectedPeers = window.chatApp?.peers || new Set();
        const peerNicknames = window.chatApp?.peerNicknames || new Map();

        // Clear previous list
        this.participantList.innerHTML = '';

        if (connectedPeers.size === 0) {
            this.participantList.innerHTML = '<div style="color: #a8a8b3; text-align: center;">No peers connected</div>';
            this.participantSelectionModal.style.display = 'flex';
            return;
        }

        // Add checkbox for each connected peer (max 3 since caller makes 4)
        let peerCount = 0;
        connectedPeers.forEach(peerId => {
            if (peerCount >= 3) return; // Maximum 3 peers + caller = 4 participants

            const nickname = peerNicknames.get(peerId) || 'Unknown';
            const item = document.createElement('div');
            item.className = 'participant-item';
            item.innerHTML = `
                <input type="checkbox" class="participant-checkbox" id="peer-${peerId}" value="${peerId}">
                <label for="peer-${peerId}" class="participant-label">${nickname}</label>
            `;
            this.participantList.appendChild(item);
            peerCount++;
        });

        // Show modal
        this.participantSelectionModal.style.display = 'flex';
    }

    // Clean up all resources
    cleanup() {
        // Clear audio output manager
        if (window.audioOutputManager) {
            // Unregister all streams
            if (this.localStream) {
                window.audioOutputManager.unregisterStream(this.localStream);
            }
            this.participants.forEach(participant => {
                if (participant.stream) {
                    window.audioOutputManager.unregisterStream(participant.stream);
                }
            });
            window.audioOutputManager.clearAudioElements();
        }

        // Stop local stream
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
            this.localStream = null;
        }

        // Close all connections
        this.callConnections.forEach(pc => {
            pc.close();
        });
        this.callConnections.clear();

        // Remove audio elements
        this.participants.forEach(participant => {
            if (participant.audioElement) {
                participant.audioElement.remove();
            }
        });
        this.participants.clear();

        // Clean up audio contexts
        this.audioContexts.forEach(({ audioContext, scriptProcessor }) => {
            scriptProcessor.disconnect();
            audioContext.close();
        });
        this.audioContexts.clear();

        // Clear UI
        if (this.participantsGrid) {
            this.participantsGrid.innerHTML = '';
        }

        // Hide interface
        this.hideGroupCallInterface();

        // Stop timer
        this.stopCallTimer();

        // Reset state
        this.currentGroupCall = null;
    }

    // Send group call response
    sendGroupCallResponse(to, callId, accepted) {
        // Send directly through WebRTC to all peers, they'll filter by 'to' field
        this.webrtcHandler.sendMessage({
            type: accepted ? 'group-call-accept' : 'group-call-reject',
            callId: callId,
            from: this.userId,
            fromNickname: this.nickname,
            to: to,
            timestamp: Date.now()
        });
    }

    // Handle messages
    handleMessage(message) {
        switch (message.type) {
            case 'group-call-invite':
                this.handleGroupCallInvite(message);
                break;
            case 'group-call-accept':
                this.handleGroupCallAccept(message);
                break;
            case 'group-call-reject':
                this.handleGroupCallReject(message);
                break;
            case 'group-call-offer':
                this.handleGroupCallOffer(message);
                break;
            case 'group-call-answer':
                this.handleGroupCallAnswer(message);
                break;
            case 'group-call-ice':
                this.handleGroupCallICE(message);
                break;
            case 'group-call-participant-joined':
                this.handleParticipantJoined(message);
                break;
            case 'group-call-participant-left':
                this.handleParticipantLeft(message);
                break;
            case 'group-call-mute-status':
                this.handleMuteStatus(message);
                break;
            case 'group-call-end':
                this.handleGroupCallEnd(message);
                break;
        }
    }

    // Handle group call accept
    async handleGroupCallAccept(message) {
        if (!this.currentGroupCall || this.currentGroupCall.id !== message.callId) return;

        // Check if message is for us
        if (message.to && message.to !== this.userId) return;

        console.log(`${message.fromNickname} accepted the group call`);

        // Add to participants
        this.currentGroupCall.participants.add(message.from);

        // IMPORTANT: Connect to accepting participant if we don't have a connection yet
        if (!this.callConnections.has(message.from)) {
            // Determine who initiates based on ID comparison
            const shouldInitiate = this.userId < message.from;
            console.log(`[GroupCall] Accept from ${message.from}, shouldInitiate: ${shouldInitiate}`);

            if (shouldInitiate) {
                console.log(`[GroupCall] Initiating connection to accepting participant ${message.from}`);
                await this.connectToParticipant(message.from, true);
            } else {
                console.log(`[GroupCall] Waiting for accepting participant ${message.from} to initiate`);
            }
        }

        // If we're the initiator, broadcast participant joined message to everyone
        if (this.currentGroupCall.initiator === this.userId) {
            // Broadcast to ALL participants that someone joined
            this.webrtcHandler.sendMessage({
                type: 'group-call-participant-joined',
                callId: this.currentGroupCall.id,
                from: message.from,
                fromNickname: message.fromNickname,
                timestamp: Date.now()
            });
        }
    }

    // Handle group call reject
    handleGroupCallReject(message) {
        if (!this.currentGroupCall || this.currentGroupCall.id !== message.callId) return;

        console.log(`${message.fromNickname} rejected the group call`);

        // Remove from participants list
        this.currentGroupCall.participants.delete(message.from);

        if (this.currentGroupCall.participants.size === 0) {
            this.updateCallStatus('No one joined');
            setTimeout(() => this.endGroupCall(), 2000);
        }
    }

    // Handle group call offer
    async handleGroupCallOffer(message) {
        if (!this.currentGroupCall || this.currentGroupCall.id !== message.callId) return;
        if (message.to && message.to !== this.userId) return;

        console.log(`[GroupCall] Received offer from ${message.from}`);

        let pc = this.callConnections.get(message.from);
        if (!pc) {
            console.log(`[GroupCall] Creating new connection for offer from ${message.from}`);
            pc = await this.connectToParticipant(message.from, false);
        }

        try {
            await pc.setRemoteDescription(new RTCSessionDescription(message.offer));
            const answer = await pc.createAnswer({
                offerToReceiveAudio: true,
                offerToReceiveVideo: false
            });
            await pc.setLocalDescription(answer);

            console.log(`[GroupCall] Sending answer to ${message.from}`);
            this.webrtcHandler.sendMessage({
                type: 'group-call-answer',
                callId: this.currentGroupCall.id,
                answer: answer,
                from: this.userId,
                to: message.from,
                timestamp: Date.now()
            });
        } catch (error) {
            console.error(`[GroupCall] Error handling offer from ${message.from}:`, error);
        }
    }

    // Handle group call answer
    async handleGroupCallAnswer(message) {
        if (!this.currentGroupCall || this.currentGroupCall.id !== message.callId) return;
        if (message.to && message.to !== this.userId) return;

        const pc = this.callConnections.get(message.from);
        if (pc) {
            await pc.setRemoteDescription(new RTCSessionDescription(message.answer));
        }
    }

    // Handle ICE candidates
    async handleGroupCallICE(message) {
        if (!this.currentGroupCall || this.currentGroupCall.id !== message.callId) return;
        if (message.to && message.to !== this.userId) return;

        const pc = this.callConnections.get(message.from);
        if (pc) {
            await pc.addIceCandidate(new RTCIceCandidate(message.candidate));
        }
    }

    // Handle mute status
    handleMuteStatus(message) {
        if (!this.currentGroupCall || this.currentGroupCall.id !== message.callId) return;

        const indicator = document.getElementById(`muted-${message.from}`);
        if (indicator) {
            indicator.style.display = message.isMuted ? 'inline' : 'none';
        }
    }

    // Handle participant joined
    async handleParticipantJoined(message) {
        if (!this.currentGroupCall || this.currentGroupCall.id !== message.callId) return;

        console.log(`${message.fromNickname} joined the group call`);

        // Add new participant
        this.currentGroupCall.participants.add(message.from);

        // IMPORTANT: For group calls, ALL existing participants should connect to the new participant
        // The new participant will connect to all existing participants they don't have connections with
        // This ensures full mesh connectivity

        // If we don't have a connection with this participant yet, establish one
        if (!this.callConnections.has(message.from)) {
            // Determine who initiates connection based on ID comparison
            const shouldInitiate = this.userId < message.from;
            console.log(`Connection needed with ${message.from}. Should initiate: ${shouldInitiate}`);

            if (shouldInitiate) {
                console.log(`Initiating connection to new participant ${message.from}`);
                await this.connectToParticipant(message.from, true);
            } else {
                console.log(`Waiting for ${message.from} to initiate connection`);
            }
        } else {
            console.log(`Already connected to ${message.from}`);
        }
    }

    // Handle participant left
    handleParticipantLeft(message) {
        if (!this.currentGroupCall || this.currentGroupCall.id !== message.callId) return;

        this.removeParticipant(message.from);
    }

    // Remove participant
    removeParticipant(peerId) {
        // Close connection
        const pc = this.callConnections.get(peerId);
        if (pc) {
            pc.close();
            this.callConnections.delete(peerId);
        }

        // Remove audio element
        const participant = this.participants.get(peerId);
        if (participant && participant.audioElement) {
            participant.audioElement.remove();
        }
        this.participants.delete(peerId);

        // Remove from UI
        const card = document.getElementById(`participant-${peerId}`);
        if (card) {
            card.remove();
            this.updateGridLayout();
        }

        // Clean up audio context
        const audioContext = this.audioContexts.get(peerId);
        if (audioContext) {
            audioContext.scriptProcessor.disconnect();
            audioContext.audioContext.close();
            this.audioContexts.delete(peerId);
        }

        // Check if call should end
        if (this.participants.size === 0 && this.currentGroupCall) {
            this.updateCallStatus('Call ended - everyone left');
            setTimeout(() => this.endGroupCall(), 2000);
        }
    }

    // Handle group call end
    handleGroupCallEnd(message) {
        if (!this.currentGroupCall || this.currentGroupCall.id !== message.callId) return;

        this.updateCallStatus('Call ended');
        setTimeout(() => this.cleanup(), 1000);
    }
}

// Export
window.GroupCallHandler = GroupCallHandler;