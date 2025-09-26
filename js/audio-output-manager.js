// Audio Output Manager for switching between earpiece, speaker, and bluetooth
class AudioOutputManager {
    constructor() {
        // Audio output modes
        this.OUTPUT_MODES = {
            EARPIECE: 'earpiece',
            SPEAKER: 'speaker',
            BLUETOOTH: 'bluetooth'
        };

        // Current output mode
        this.currentMode = this.OUTPUT_MODES.EARPIECE;

        // Available devices
        this.availableDevices = [];

        // Audio elements to manage
        this.audioElements = [];

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
        this.currentMode = this.OUTPUT_MODES.EARPIECE;

        if (this.supportsOutputSelection) {
            // Try to find earpiece device
            const earpiece = this.availableDevices.find(device =>
                device.label.toLowerCase().includes('earpiece') ||
                device.label.toLowerCase().includes('receiver') ||
                device.deviceId === 'default'
            );

            if (earpiece) {
                await this.setOutputDevice(earpiece.deviceId);
            } else {
                // Use default device
                await this.setOutputDevice('default');
            }
        }

        // For mobile browsers, try to use audio constraints
        this.updateAudioConstraints(false); // false = not speakerphone
        this.showOutputStatus('Earpiece');
    }

    // Switch to speaker
    async switchToSpeaker() {
        this.currentMode = this.OUTPUT_MODES.SPEAKER;

        if (this.supportsOutputSelection) {
            // Try to find speaker device
            const speaker = this.availableDevices.find(device =>
                device.label.toLowerCase().includes('speaker') ||
                device.label.toLowerCase().includes('speakerphone')
            );

            if (speaker) {
                await this.setOutputDevice(speaker.deviceId);
            }
        }

        // For mobile browsers, try to use audio constraints
        this.updateAudioConstraints(true); // true = speakerphone
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

    // Update audio constraints for mobile browsers
    updateAudioConstraints(useSpeakerphone) {
        // This is primarily for mobile browsers that don't support setSinkId
        // We can hint to use speakerphone through constraints

        // Check both call handler and group call handler for streams
        const streams = [];
        if (window.chatApp?.callHandler?.localStream) {
            streams.push(window.chatApp.callHandler.localStream);
        }
        if (window.chatApp?.groupCallHandler?.localStream) {
            streams.push(window.chatApp.groupCallHandler.localStream);
        }

        streams.forEach(stream => {
            const audioTracks = stream.getAudioTracks();
            audioTracks.forEach(track => {
                try {
                    // Some mobile browsers support these constraints
                    const constraints = {
                        echoCancellation: !useSpeakerphone,
                        noiseSuppression: true,
                        autoGainControl: true
                    };

                    // Add non-standard constraints that some browsers support
                    if (useSpeakerphone) {
                        // @ts-ignore
                        constraints.speakerphone = true;
                        // @ts-ignore
                        constraints.googEchoCancellation = false;
                        // @ts-ignore
                        constraints.googAutoGainControl = false;
                    } else {
                        // @ts-ignore
                        constraints.speakerphone = false;
                        // @ts-ignore
                        constraints.googEchoCancellation = true;
                        // @ts-ignore
                        constraints.googAutoGainControl = true;
                    }

                    track.applyConstraints(constraints);
                    console.log(`[AudioOutput] Applied constraints for ${useSpeakerphone ? 'speaker' : 'earpiece'}`);
                } catch (error) {
                    console.warn('[AudioOutput] Could not apply audio constraints:', error);
                }
            });
        });

        // For iOS Safari, we might need to recreate the audio context
        if (this.isIOS()) {
            this.handleIOSAudioRouting(useSpeakerphone);
        }
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
            this.audioElements.push(element);

            // Apply current output mode
            if (this.supportsOutputSelection && this.currentMode === this.OUTPUT_MODES.SPEAKER) {
                this.setOutputDevice('default');
            }
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