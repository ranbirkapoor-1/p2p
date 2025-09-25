# P2P Chat Application

## Project Philosophy

### Core Principles

#### 1. Function Over Form
We prioritize **working functionality** over aesthetic design. A functional application can have its design improved iteratively, but a beautiful non-working application serves no purpose. Every feature must work reliably before we consider its visual appeal.

#### 2. Continuous Documentation
Every modification to the codebase must be documented in `FIXES_IMPLEMENTED.md` with:
- **Date and Time** of the change
- **Problem Description** - What wasn't working
- **Solution Implemented** - How it was fixed
- **Files Modified** - Which files were affected
- **Testing Status** - Whether it's been verified

#### 3. Version Tracking
The application displays its version on the login screen. This version automatically increments with each code change, providing:
- Clear tracking of application evolution
- Easy reference for debugging
- Quick identification of deployed versions

#### 4. Consistent Theme
While functionality takes precedence, we maintain theme consistency across the application:
- Dark mode interface for reduced eye strain
- Consistent color palette (purples, blues, grays)
- Uniform spacing and sizing
- Coherent interaction patterns

## Development Guidelines

### Before Making Changes

1. **Document the Issue**
   - What's broken or needs improvement?
   - Why is this change necessary?
   - What's the expected outcome?

2. **Test Current Functionality**
   - Ensure existing features still work
   - Note any dependencies that might be affected

### After Making Changes

1. **Update FIXES_IMPLEMENTED.md**
   ```markdown
   ### [DATE TIME] - Brief Description
   **Problem**: What was broken
   **Solution**: How it was fixed
   **Files Modified**: List of files
   **Testing**: Current status
   ```

2. **Increment Version**
   - Version updates automatically on code changes
   - Format: `v[MAJOR].[MINOR].[PATCH]`

3. **Test Thoroughly**
   - Test the specific fix
   - Verify no regressions
   - Test with multiple users if applicable

## Quick Start

### Prerequisites
- Modern web browser (Chrome, Firefox, Safari)
- HTTPS connection (required for WebRTC)
- Firebase project (for signaling)

### Local Development
```bash
# Clone the repository
git clone [repository-url]

# Open index.html in a browser
# Or use a local server for better development experience
python -m http.server 8000
# Navigate to http://localhost:8000
```

### Deployment (GitHub Pages)
1. Push code to GitHub repository
2. Enable GitHub Pages in repository settings
3. Access via `https://ranbirkapoor-1.github.io/p2p`

## Project Structure

```
p2p/
├── index.html                 # Main application entry
├── js/
│   ├── app.js                # Core application logic
│   ├── webrtc-handler.js     # P2P connection management
│   ├── firebase-handler.js   # Signaling server interface
│   ├── message-handler.js    # Chat messaging system
│   ├── file-handler.js       # File sharing functionality
│   ├── call-handler.js       # 1-on-1 audio/video calls
│   └── group-call-handler.js # Group audio calls (up to 4)
├── style.css
└── FIXES_IMPLEMENTED.md      # Change history with timestamps
```

## Features

### Core Functionality
- ✅ **Pure P2P Communication** - No server involvement after initial connection
- ✅ **Text Messaging** - Real-time chat with typing indicators
- ✅ **File Sharing** - Direct P2P file transfer
- ✅ **Audio/Video Calls** - 1-on-1 WebRTC calls
- ✅ **Group Audio Calls** - Up to 4 participants in mesh network
- ✅ **Manual Reconnection** - Simple reconnect button when disconnected

### Technical Features
- **WebRTC Data Channels** - For messaging and file transfer
- **WebRTC Media Streams** - For audio/video communication
- **Firebase Signaling** - Initial connection establishment only
- **Mesh Networking** - Full P2P mesh for group calls
- **Voice Activity Detection** - Visual feedback during calls

## Testing Guidelines

### Basic Functionality Test
1. Join a room alone - verify "You (1 user)" display
2. Send a message to yourself
3. Share a file with yourself
4. Test reconnection button

### Multi-User Test
1. Open 2-3 browser windows
2. Join same room with different nicknames
3. Test messaging between all peers
4. Test file sharing
5. Test audio/video calls

### Group Call Test
1. Connect 3-4 users to same room
2. Start group audio call
3. Verify all participants can hear each other
4. Test mute/unmute functionality
5. Test participant leaving and rejoining

## Troubleshooting

### Common Issues

**P2P Connection Fails**
- Check firewall settings
- Ensure HTTPS is used
- Verify STUN/TURN servers are accessible

**Audio/Video Not Working**
- Grant microphone/camera permissions
- Check HTTPS requirement
- Verify browser compatibility

**Firebase Connection Issues**
- Check Firebase configuration in `config.js`
- Verify database rules allow read/write
- Check network connectivity

## Contributing

### Development Workflow
1. Identify issue or feature need
2. Document the plan
3. Implement the solution
4. Test thoroughly
5. Update FIXES_IMPLEMENTED.md
6. Commit with descriptive message

### Code Style
- Clear variable names
- Comprehensive logging with prefixes
- Error handling at all levels
- Comments for complex logic

### Testing Requirements
- Test with multiple browsers
- Test with varying network conditions
- Test edge cases (disconnection, rejoining)
- Verify backward compatibility

## Version History

See `FIXES_IMPLEMENTED.md` for detailed change history with timestamps.

## Philosophy Reminder

> "We believe in making things work first, then making them beautiful. A working prototype can be polished; a polished mockup cannot suddenly start functioning."

Every line of code should serve the user's need for reliable, real-time communication. Design enhancements come after functionality is rock-solid.

## Support

For issues or questions:
1. Check `FIXES_IMPLEMENTED.md` for recent changes
2. Review browser console for error messages
3. Test with `debug.html` for detailed diagnostics
4. Create an issue with:
   - Browser version
   - Steps to reproduce
   - Console error messages
   - Current version number

---

*Remember: Function first, form follows function.*