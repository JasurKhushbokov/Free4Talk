# Voice Chat App

A real-time voice chat application with text messaging functionality built with React, Node.js, Socket.io, and WebRTC.

## Features

- 🎙️ Real-time voice communication using WebRTC
- 💬 Text chat within rooms
- 🏠 Room creation and management
- 👥 Multiple participants per room
- 🔇 Mute/unmute functionality
- 📱 Responsive design
- 🔄 Real-time participant updates

## Tech Stack

- **Frontend**: React, Socket.io-client, WebRTC APIs
- **Backend**: Node.js, Express, Socket.io
- **Real-time Communication**: WebRTC for voice, Socket.io for signaling and chat

## Getting Started

### Prerequisites

- Node.js (v14 or higher)
- npm or yarn

### Installation

1. Clone the repository and navigate to the project directory
2. Install all dependencies:
   ```bash
   npm run install-all
   ```

### Running the Application

1. Start both server and client in development mode:
   ```bash
   npm run dev
   ```

   This will start:
   - Server on `http://localhost:5000`
   - Client on `http://localhost:3000`

2. Open your browser and go to `http://localhost:3000`

### Usage

1. **Join the App**: Enter your username to join
2. **Create/Join Room**: Create a new room or join an existing one
3. **Voice Chat**: Allow microphone access when prompted
4. **Text Chat**: Send messages in the chat panel
5. **Controls**: Use the mute button to toggle your microphone

## Project Structure

```
voice-chat-app/
├── client/                 # React frontend
│   ├── src/
│   │   ├── App.js         # Main application component
│   │   ├── App.css        # Component styles
│   │   ├── index.js       # React entry point
│   │   └── index.css      # Global styles
│   └── package.json
├── server/                 # Node.js backend
│   ├── index.js           # Server entry point
│   └── package.json
└── package.json           # Root package.json

```

## How It Works

### WebRTC Voice Communication
- Uses peer-to-peer connections for low-latency voice chat
- STUN servers for NAT traversal
- Automatic connection management for multiple participants

### Socket.io Signaling
- Handles WebRTC signaling (offers, answers, ICE candidates)
- Room management and user presence
- Real-time text messaging

### Room Management
- Dynamic room creation and joining
- Real-time participant updates
- Message history per room

## Browser Compatibility

- Chrome/Chromium (recommended)
- Firefox
- Safari (with limitations)
- Edge

**Note**: Microphone access is required for voice chat functionality.

## Development

### Running Components Separately

Server only:
```bash
cd server && npm run dev
```

Client only:
```bash
cd client && npm start
```

## Troubleshooting

### Common Issues

1. **Microphone not working**: Ensure browser permissions are granted
2. **Connection issues**: Check if both server and client are running
3. **Audio not heard**: Check browser audio settings and mute status

### HTTPS Requirements

For production deployment, HTTPS is required for:
- Microphone access
- WebRTC functionality

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

MIT License - feel free to use this project for learning and development purposes.
