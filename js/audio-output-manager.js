// Audio Output Manager for switching between earpiece, speaker, and bluetooth
class AudioOutputManager {
    constructor() {
        // Audio output modes
        this.OUTPUT_MODES = {
            EARPIECE: 'earpiece',
            SPEAKER: 'speaker',
            BLUETOOTH: 'bluetooth'
        };

        // Current output mode - default to speaker for better compatibility
        this.currentMode = this.OUTPUT_MODES.SPEAKER;

        // Available devices
        this.availableDevices = [];

        // Audio elements to manage
        this.audioElements = [];

        // Store reference to active media streams
        this.activeStreams = new Set();

        // Check for device enumeration support
        this.supportsDeviceEnumeration = navigator.mediaDevices && navigator.mediaDevices.enumerateDevices;

        // Check for setSinkId support (needed for output switching)
        this.supportsOutputSelection = 'setSinkId' in HTMLMediaElement.prototype;

        // Initialize
        this.init();
    }

    async init() {
        if (this.supportsDeviceEnumeration) {
            await this.updateAvailableDevices();

            // Listen for device changes
            navigator.mediaDevices.addEventListener('devicechange', () => {
                this.updateAvailableDevices();
            });
        }
    }

    // Update available audio output devices
    async updateAvailableDevices() {
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            this.availableDevices = devices.filter(device => device.kind === 'audiooutput');

            console.log('[AudioOutput] Available audio outputs:', this.availableDevices.map(d => ({
                label: d.label,
                id: d.deviceId
            })));
        } catch (error) {
            console.error('[AudioOutput] Error enumerating devices:', error);
        }
    }

    // Set default audio output based on call type
    async setDefaultForCallType(isGroupCall = false) {
        if (isGroupCall) {
            // Group calls default to speaker
            console.log('[AudioOutput] Setting default for group call: SPEAKER');
            await this.switchToSpeaker();
        } else {
            // 1-to-1 calls default to earpiece
            console.log('[AudioOutput] Setting default for 1-to-1 call: EARPIECE');
            await this.switchToEarpiece();
        }
    }

    // Switch to next available output
    async switchOutput() {
        const modes = [this.OUTPUT_MODES.EARPIECE, this.OUTPUT_MODES.SPEAKER];

        // Add bluetooth if available
        if (this.hasBluetoothDevice()) {
            modes.push(this.OUTPUT_MODES.BLUETOOTH);
        }

        // Find current index and switch to next
        const currentIndex = modes.indexOf(this.currentMode);
        const nextIndex = (currentIndex + 1) % modes.length;
        const nextMode = modes[nextIndex];

        console.log(`[AudioOutput] Switching from ${this.currentMode} to ${nextMode}`);

        switch (nextMode) {
            case this.OUTPUT_MODES.EARPIECE:
                await this.switchToEarpiece();
                break;
            case this.OUTPUT_MODES.SPEAKER:
                await this.switchToSpeaker();
                break;
            case this.OUTPUT_MODES.BLUETOOTH:
                await this.switchToBluetooth();
                break;
        }

        return nextMode;
    }

    // Switch to earpiece (default output)
    async switchToEarpiece() {
        console.log('[AudioOutput] Attempting to switch to earpiece');
        this.currentMode = this.OUTPUT_MODES.EARPIECE;

        // For all audio/video elements, set volume to normal and try setSinkId if available
        this.audioElements.forEach(element => {
            if (element) {
                element.volume = 0.7; // Slightly lower volume for earpiece
                if (this.supportsOutputSelection) {
                    // Try to find earpiece device
                    const earpiece = this.availableDevices.find(device =>
                        device.label.toLowerCase().includes('earpiece') ||
                        device.label.toLowerCase().includes('receiver') ||
                        device.deviceId === 'default'
                    );

                    if (earpiece && element.setSinkId) {
                        element.setSinkId(earpiece.deviceId).catch(e =>
                            console.warn('[AudioOutput] setSinkId failed:', e)
                        );
                    }
                }
            }
        });

        // Apply constraints to all active streams
        await this.applyAudioConstraintsToAllStreams(false);

        // Mobile-specific workarounds
        if (this.isMobile()) {
            await this.forceMobileAudioRoute(false);
        }

        this.showOutputStatus('Earpiece');
    }

    // Switch to speaker
    async switchToSpeaker() {
        console.log('[AudioOutput] Attempting to switch to speaker');
        this.currentMode = this.OUTPUT_MODES.SPEAKER;

        // For all audio/video elements, set volume to max and try setSinkId if available
        this.audioElements.forEach(element => {
            if (element) {
                element.volume = 1.0; // Max volume for speaker
                if (this.supportsOutputSelection) {
                    // Try to find speaker device
                    const speaker = this.availableDevices.find(device =>
                        device.label.toLowerCase().includes('speaker') ||
                        device.label.toLowerCase().includes('speakerphone')
                    );

                    if (speaker && element.setSinkId) {
                        element.setSinkId(speaker.deviceId).catch(e =>
                            console.warn('[AudioOutput] setSinkId failed:', e)
                        );
                    }
                }
            }
        });

        // Apply constraints to all active streams
        await this.applyAudioConstraintsToAllStreams(true);

        // Mobile-specific workarounds
        if (this.isMobile()) {
            await this.forceMobileAudioRoute(true);
        }

        this.showOutputStatus('Speaker');
    }

    // Switch to bluetooth
    async switchToBluetooth() {
        this.currentMode = this.OUTPUT_MODES.BLUETOOTH;

        if (this.supportsOutputSelection) {
            // Try to find bluetooth device
            const bluetooth = this.availableDevices.find(device =>
                device.label.toLowerCase().includes('bluetooth') ||
                device.label.toLowerCase().includes('airpods') ||
                device.label.toLowerCase().includes('headset')
            );

            if (bluetooth) {
                await this.setOutputDevice(bluetooth.deviceId);
                this.showOutputStatus('Bluetooth');
            } else {
                // Fall back to speaker if no bluetooth found
                console.warn('[AudioOutput] No bluetooth device found, falling back to speaker');
                await this.switchToSpeaker();
            }
        } else {
            this.showOutputStatus('Bluetooth (if connected)');
        }
    }

    // Check if bluetooth device is available
    hasBluetoothDevice() {
        return this.availableDevices.some(device =>
            device.label.toLowerCase().includes('bluetooth') ||
            device.label.toLowerCase().includes('airpods') ||
            device.label.toLowerCase().includes('headset')
        );
    }

    // Set output device for all audio elements
    async setOutputDevice(deviceId) {
        console.log(`[AudioOutput] Setting output device to: ${deviceId}`);

        for (const element of this.audioElements) {
            try {
                if (element && element.setSinkId) {
                    await element.setSinkId(deviceId);
                    console.log(`[AudioOutput] Set output for audio element`);
                }
            } catch (error) {
                console.error('[AudioOutput] Error setting audio output:', error);
            }
        }
    }

    // Apply audio constraints to all active streams
    async applyAudioConstraintsToAllStreams(useSpeakerphone) {
        console.log(`[AudioOutput] Applying constraints for ${useSpeakerphone ? 'speaker' : 'earpiece'} to all streams`);

        // Collect all streams from various sources
        const streams = [];

        // Get streams from call handlers
        if (window.chatApp?.callHandler?.localStream) {
            streams.push(window.chatApp.callHandler.localStream);
        }
        if (window.chatApp?.groupCallHandler?.localStream) {
            streams.push(window.chatApp.groupCallHandler.localStream);
        }

        // Also get from stored active streams
        this.activeStreams.forEach(stream => {
            if (!streams.includes(stream)) {
                streams.push(stream);
            }
        });

        // Apply constraints to each stream
        for (const stream of streams) {
            const audioTracks = stream.getAudioTracks();
            for (const track of audioTracks) {
                try {
                    const constraints = {
                        echoCancellation: !useSpeakerphone,
                        noiseSuppression: !useSpeakerphone,
                        autoGainControl: !useSpeakerphone,
                        sampleRate: useSpeakerphone ? 48000 : 16000,
                        channelCount: useSpeakerphone ? 2 : 1
                    };

                    await track.applyConstraints(constraints);
                    console.log(`[AudioOutput] Applied constraints to track:`, constraints);
                } catch (error) {
                    console.warn('[AudioOutput] Could not apply standard constraints:', error);

                    // Try with minimal constraints
                    try {
                        await track.applyConstraints({
                            echoCancellation: !useSpeakerphone
                        });
                    } catch (e) {
                        console.warn('[AudioOutput] Could not apply minimal constraints:', e);
                    }
                }
            }
        }
    }

    // Force mobile audio routing using various techniques
    async forceMobileAudioRoute(useSpeakerphone) {
        console.log(`[AudioOutput] Forcing mobile audio route to ${useSpeakerphone ? 'speaker' : 'earpiece'}`);

        // Method 1: Play silent audio to force routing
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();

            oscillator.frequency.value = useSpeakerphone ? 20000 : 1000; // High freq for speaker, low for earpiece
            gainNode.gain.value = 0; // Silent

            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);

            oscillator.start();
            setTimeout(() => oscillator.stop(), 100);

            // Set proper audio session category hints
            if (audioContext.destination) {
                audioContext.destination.channelCount = useSpeakerphone ? 2 : 1;
            }
        } catch (e) {
            console.warn('[AudioOutput] Audio context method failed:', e);
        }

        // Method 2: Create and play a silent audio element
        try {
            const audio = new Audio();
            audio.src = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAA==';
            audio.volume = useSpeakerphone ? 1.0 : 0.3;

            // Try to set sink if supported
            if (audio.setSinkId && this.availableDevices.length > 0) {
                const targetDevice = this.availableDevices.find(device => {
                    const label = device.label.toLowerCase();
                    if (useSpeakerphone) {
                        return label.includes('speaker') || label.includes('speakerphone');
                    } else {
                        return label.includes('earpiece') || label.includes('receiver') || device.deviceId === 'default';
                    }
                });

                if (targetDevice) {
                    await audio.setSinkId(targetDevice.deviceId);
                }
            }

            await audio.play();
            setTimeout(() => {
                audio.pause();
                audio.remove();
            }, 100);
        } catch (e) {
            console.warn('[AudioOutput] Silent audio method failed:', e);
        }
    }

    // Update audio constraints for mobile browsers (deprecated, kept for compatibility)
    updateAudioConstraints(useSpeakerphone) {
        this.applyAudioConstraintsToAllStreams(useSpeakerphone);
    }

    // Handle iOS-specific audio routing
    handleIOSAudioRouting(useSpeakerphone) {
        // iOS-specific handling
        // Note: Full audio routing on iOS requires native app capabilities
        // Web apps have limited control, but we can try some workarounds

        // Try to use Web Audio API for better control
        if (window.AudioContext || window.webkitAudioContext) {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            const context = new AudioContext();

            // This might help iOS route audio appropriately
            if (useSpeakerphone) {
                // Higher sample rate might trigger speaker
                context.destination.channelCount = 2;
            } else {
                // Lower sample rate might trigger earpiece
                context.destination.channelCount = 1;
            }
        }
    }

    // Register an audio element to manage
    registerAudioElement(element) {
        if (element && !this.audioElements.includes(element)) {
            console.log('[AudioOutput] Registering audio element');
            this.audioElements.push(element);

            // Apply current output mode
            if (this.currentMode === this.OUTPUT_MODES.SPEAKER) {
                element.volume = 1.0;
                if (this.supportsOutputSelection) {
                    this.setOutputDevice('default');
                }
            } else {
                element.volume = 0.7;
            }

            // Ensure element plays through
            element.setAttribute('playsinline', 'true');
            element.setAttribute('autoplay', 'true');
        }
    }

    // Register a media stream
    registerStream(stream) {
        if (stream) {
            console.log('[AudioOutput] Registering media stream');
            this.activeStreams.add(stream);

            // Apply current mode constraints
            this.applyAudioConstraintsToAllStreams(this.currentMode === this.OUTPUT_MODES.SPEAKER);
        }
    }

    // Unregister a media stream
    unregisterStream(stream) {
        if (stream) {
            this.activeStreams.delete(stream);
        }
    }

    // Unregister an audio element
    unregisterAudioElement(element) {
        const index = this.audioElements.indexOf(element);
        if (index > -1) {
            this.audioElements.splice(index, 1);
        }
    }

    // Clear all audio elements
    clearAudioElements() {
        this.audioElements = [];
    }

    // Show output status to user
    showOutputStatus(mode) {
        // Update button titles
        const audioBtn = document.getElementById('audioOutputBtn');
        const groupAudioBtn = document.getElementById('groupAudioOutputBtn');

        const title = `Audio Output: ${mode}`;
        if (audioBtn) audioBtn.title = title;
        if (groupAudioBtn) groupAudioBtn.title = title;

        // Show temporary notification
        if (window.chatApp?.messageHandler) {
            window.chatApp.messageHandler.displaySystemMessage(`🔊 Audio output: ${mode}`);
        }
    }

    // Check if running on iOS
    isIOS() {
        return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    }

    // Check if running on Android
    isAndroid() {
        return /Android/.test(navigator.userAgent);
    }

    // Check if running on mobile
    isMobile() {
        return this.isIOS() || this.isAndroid() || /Mobile|mobile/.test(navigator.userAgent);
    }

    // Get current output mode display name
    getCurrentModeDisplay() {
        switch (this.currentMode) {
            case this.OUTPUT_MODES.EARPIECE:
                return 'Earpiece';
            case this.OUTPUT_MODES.SPEAKER:
                return 'Speaker';
            case this.OUTPUT_MODES.BLUETOOTH:
                return 'Bluetooth';
            default:
                return 'Default';
        }
    }
}

// Create global instance
window.audioOutputManager = new AudioOutputManager();

// Export for module use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = AudioOutputManager;
}