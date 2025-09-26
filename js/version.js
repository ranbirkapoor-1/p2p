// Version Management System
// This file tracks the application version
// Version should be incremented with each code change

const APP_VERSION = {
    major: 1,
    minor: 0,
    patch: 7,

    // Auto-increment patch version on code changes
    // Format: YYYYMMDDHHMMSS of last update
    lastUpdate: '20250926201500',

    // Get formatted version string
    getString() {
        return `v${this.major}.${this.minor}.${this.patch}`;
    },

    // Get full version with timestamp
    getFullVersion() {
        const date = this.formatDate(this.lastUpdate);
        return `${this.getString()} (${date})`;
    },

    // Format date from timestamp
    formatDate(timestamp) {
        const year = timestamp.substring(0, 4);
        const month = timestamp.substring(4, 6);
        const day = timestamp.substring(6, 8);
        const hour = timestamp.substring(8, 10);
        const min = timestamp.substring(10, 12);
        return `${year}-${month}-${day} ${hour}:${min}`;
    },

    // Update version (call this when code changes)
    increment(type = 'patch') {
        const now = new Date();
        this.lastUpdate = now.getFullYear().toString() +
                         (now.getMonth() + 1).toString().padStart(2, '0') +
                         now.getDate().toString().padStart(2, '0') +
                         now.getHours().toString().padStart(2, '0') +
                         now.getMinutes().toString().padStart(2, '0') +
                         now.getSeconds().toString().padStart(2, '0');

        switch(type) {
            case 'major':
                this.major++;
                this.minor = 0;
                this.patch = 0;
                break;
            case 'minor':
                this.minor++;
                this.patch = 0;
                break;
            case 'patch':
            default:
                this.patch++;
                break;
        }

        // Log version change
        console.log(`[Version] Updated to ${this.getString()} at ${this.formatDate(this.lastUpdate)}`);
    }
};

// Display version on page load
document.addEventListener('DOMContentLoaded', () => {
    const versionElement = document.querySelector('.version-info');
    if (versionElement) {
        versionElement.textContent = APP_VERSION.getString();
        versionElement.title = APP_VERSION.getFullVersion();
    }

    // Log version to console
    console.log(`[App] P2P Chat ${APP_VERSION.getFullVersion()}`);
});

// Export for use in other modules
window.APP_VERSION = APP_VERSION;