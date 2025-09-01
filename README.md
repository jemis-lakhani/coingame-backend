# Coin Game (Backend)

This is the **backend repository** for the Coin Game.  
It powers the game by handling socket connections, game state, timers, and player management.

## 🚀 Features
- **Socket.IO server** to manage real-time communication.
- Host can **create/reset rooms**.
- Players can **join teams** and be tracked in real-time.
- Provides APIs & socket events for:
  - Resetting timers
  - Listing players
  - Handling game events
- Syncs with the frontend for a smooth gameplay experience.

## 🏗️ Tech Stack
- **Node.js**
- **Express.js**
- **Socket.IO**

## 📂 Project Structure
/src
/controllers # Game and room controllers
/sockets # Socket.IO event handlers
/utils # Utility functions
index.js # App entry point


## ⚡ Getting Started

### 1. Clone the Repository
```bash
git clone https://github.com/jemis-lakhani/coingame-backend.git
cd coingame-backend
```

2. Install Dependencies
```bash
npm install
# or
yarn install
```

3. Run the Server
```bash
npm start
```

Backend will run on:
```bash
👉 http://localhost:5000 (default)
👉 Socket.IO endpoint: /socket
```

## 🔌 API / Socket Events

create-room → Host creates a new room.

join-room → Players join an existing room.

reset-time → Resets round timer.

list-players → Lists all active players in a room.

Additional events for gameplay sync with frontend.

## 🧪 Testing

Use Postman / Socket.IO client to test connections.
