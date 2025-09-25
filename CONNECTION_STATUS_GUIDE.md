# Connection Status & Peer Count Guide

## Status Dots (Traffic Light System)

### 🟢 GREEN (Connected)
**When it shows:**
- You're alone in the room but connected to Firebase
- You're connected to ALL peers in the room via P2P
- Everything is working perfectly

**What it means:**
- You can send/receive messages
- File sharing is available (if peers exist)
- Video/audio calls are available (if peers exist)

### 🟡 YELLOW (Connecting)
**When it shows:**
- You're in a room with other users but establishing P2P connections
- Some peers are connected but not all
- Connection attempts are in progress

**What it means:**
- Firebase connection is active
- P2P connections are being established
- Wait a moment for full connectivity

### 🔴 RED (Disconnected)
**When it shows:**
- You're not in any room
- You lost all P2P connections (but still in Firebase room)
- Complete connection failure

**What it means:**
- No P2P communication possible
- Reconnect button appears if peers exist
- Need to reconnect or rejoin

### ⚫ GRAY (Paused)
**When it shows:**
- Tab has been inactive for 30+ seconds
- Connections are paused to save resources

**What it means:**
- Connections will resume when tab becomes active
- No messages will be lost

## Peer Count Display

### Format: `X users (Status)`

**Examples:**

1. **"Not connected"**
   - You haven't joined a room yet

2. **"Connecting..."**
   - Joining room, waiting for user list

3. **"Alone (1 user)"**
   - You're the only one in the room
   - Status: GREEN (connected to Firebase)

4. **"2 users (All P2P)"**
   - 2 total users (including you)
   - Fully connected via P2P
   - Status: GREEN

5. **"3 users (1/2 P2P)"**
   - 3 total users in room
   - Connected to 1 out of 2 other peers
   - Status: YELLOW (partial connection)

6. **"4 users (No P2P)"**
   - 4 users in room
   - Lost all P2P connections
   - Status: RED (disconnected)
   - Reconnect button visible

## Reconnect Button

**When it appears:**
- You're in a room with other users
- You've lost ALL P2P connections
- Firebase connection may or may not be active

**What it does:**
- Rejoins the SAME room
- Keeps your nickname
- Re-establishes P2P connections

**When it's hidden:**
- During active connection attempts
- When fully connected
- When you're alone in the room
- When not in any room

## Connection Flow

### Joining a Room:
1. Enter room → Status: YELLOW
2. Connect to Firebase → Peer count updates
3. Establish P2P → Status: GREEN

### When Someone Joins:
1. New user appears → Peer count increases
2. Status: YELLOW (if was GREEN)
3. P2P established → Status: GREEN

### When Someone Leaves:
1. User leaves → Peer count decreases
2. P2P connection closed
3. Status remains GREEN if others connected

### Connection Lost:
1. P2P fails → Status: RED
2. Peer count shows "(No P2P)"
3. Reconnect button appears

### Tab Switching:
1. Tab hidden <30s → No change
2. Tab hidden >30s → Status: GRAY (paused)
3. Tab active → Resumes automatically

## Technical Details

### Connection Priority:
1. **Firebase (Signaling)**: Required for room presence
2. **WebRTC (P2P)**: Required for messaging/calls
3. **Both needed**: For full functionality

### Status Decision Logic:
```
IF not in room → RED
ELSE IF alone in room → GREEN (Firebase only)
ELSE IF connected to all peers → GREEN
ELSE IF connected to some peers → YELLOW
ELSE IF have peers but no P2P → RED (with reconnect)
ELSE → RED
```

### Peer Count Logic:
```
Total Users = All users in Firebase room (including self)
Other Peers = Total Users - 1
P2P Connected = Active WebRTC connections
Display = "Total users (P2P status)"
```