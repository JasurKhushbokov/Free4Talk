const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const { getMessageType } = require('./utils/messageTypes');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());

// Store rooms and users
const rooms = new Map();
const users = new Map();

// Room management
class Room {
  constructor(id, name, createdBy) {
    this.id = id;
    this.name = name;
    this.createdBy = createdBy;
    this.users = new Set();
    this.messages = [];
    this.createdAt = new Date();
  }

  addUser(userId, username) {
    this.users.add({ id: userId, username });
  }

  removeUser(userId) {
    this.users = new Set([...this.users].filter(user => user.id !== userId));
  }

  addMessage(message) {
    this.messages.push(message);
  }

  getUsers() {
    return [...this.users];
  }
}

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // User joins with username
  socket.on('join-app', (username) => {
    users.set(socket.id, { id: socket.id, username });
    socket.emit('user-joined', { id: socket.id, username });
    
    // Send current rooms list
    const roomsList = Array.from(rooms.values()).map(room => ({
      id: room.id,
      name: room.name,
      userCount: room.users.size,
      createdBy: room.createdBy
    }));
    socket.emit('rooms-list', roomsList);
  });

  // Create room
  socket.on('create-room', (roomName) => {
    const user = users.get(socket.id);
    if (!user) return;

    const roomId = uuidv4();
    const room = new Room(roomId, roomName, user.username);
    rooms.set(roomId, room);

    // Broadcast new room to all users
    const roomData = {
      id: room.id,
      name: room.name,
      userCount: room.users.size,
      createdBy: room.createdBy
    };
    io.emit('room-created', roomData);
    
    socket.emit('room-created-success', roomData);
  });

  // Join room
  socket.on('join-room', (roomId) => {
    const user = users.get(socket.id);
    const room = rooms.get(roomId);
    
    if (!user || !room) return;

    // Leave previous room if any
    socket.rooms.forEach(roomName => {
      if (roomName !== socket.id) {
        socket.leave(roomName);
        const prevRoom = rooms.get(roomName);
        if (prevRoom) {
          prevRoom.removeUser(socket.id);
          socket.to(roomName).emit('user-left', { id: socket.id, username: user.username });
        }
      }
    });

    // Join new room
    socket.join(roomId);
    room.addUser(socket.id, user.username);

    // Send room data to user
    socket.emit('joined-room', {
      room: {
        id: room.id,
        name: room.name,
        createdBy: room.createdBy
      },
      users: room.getUsers(),
      messages: room.messages
    });

    // Notify others in room
    socket.to(roomId).emit('user-joined-room', { id: socket.id, username: user.username });

    // Update room count for all users
    io.emit('room-updated', {
      id: room.id,
      name: room.name,
      userCount: room.users.size,
      createdBy: room.createdBy
    });
  });

  // Send message in room
  socket.on('send-message', (message) => {
    const room = rooms.get(message.roomId);
    if (room) {
      const fullMessage = {
        ...message,
        id: uuidv4(),
        timestamp: Date.now(),
        type: getMessageType(message.text)
      };
      room.addMessage(fullMessage);
      io.in(message.roomId).emit('new-message', fullMessage);
    }
  });

  // File upload handler
  const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'application/pdf', 'text/plain'];
  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

  socket.on('file-upload', (fileData, roomId) => {
    if (!ALLOWED_TYPES.includes(fileData.type)) {
      return socket.emit('file-error', { error: 'File type not allowed' });
    }
    if (fileData.size > MAX_FILE_SIZE) {
      return socket.emit('file-error', { error: 'File too large (max 10MB)' });
    }
    try {
      const fileId = uuidv4();
      const filePath = path.join(__dirname, 'uploads', fileId);
      
      fs.writeFile(filePath, fileData.content, 'base64', (err) => {
        if (err) {
          console.error('File save error:', err);
          socket.emit('file-error', { error: 'Failed to save file' });
          return;
        }
        
        const fileInfo = {
          id: fileId,
          name: fileData.name,
          type: fileData.type,
          size: fileData.size,
          sender: socket.id,
          timestamp: Date.now()
        };
        
        // Broadcast to room
        socket.to(roomId).emit('file-received', fileInfo);
        socket.emit('file-uploaded', fileInfo);
      });
    } catch (err) {
      console.error('File processing error:', err);
      socket.emit('file-error', { error: 'File processing failed' });
    }
  });

  // WebRTC signaling
  socket.on('offer', (data) => {
    socket.to(data.target).emit('offer', {
      offer: data.offer,
      sender: socket.id
    });
  });

  socket.on('answer', (data) => {
    socket.to(data.target).emit('answer', {
      answer: data.answer,
      sender: socket.id
    });
  });

  socket.on('ice-candidate', (data) => {
    socket.to(data.target).emit('ice-candidate', {
      candidate: data.candidate,
      sender: socket.id
    });
  });

  // Video signaling handlers
  socket.on('video-offer', (data) => {
    socket.to(data.target).emit('video-offer', {
      offer: data.offer,
      sender: socket.id
    });
  });

  socket.on('video-answer', (data) => {
    socket.to(data.target).emit('video-answer', {
      answer: data.answer,
      sender: socket.id
    });
  });

  // Server-side mute handling
  socket.on('user-muted', ({ userId, isMuted }) => {
    socket.broadcast.emit('user-muted-update', { userId, isMuted });
  });

  // Video toggle handling
  socket.on('video-toggle', ({ userId, hasVideo }) => {
    // Broadcast to all room participants
    const room = [...socket.rooms].find(r => r !== socket.id);
    if (room) {
      io.to(room).emit('video-toggle-update', { userId, hasVideo });
    }
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    
    const user = users.get(socket.id);
    if (user) {
      // Remove from all rooms
      socket.rooms.forEach(roomId => {
        if (roomId !== socket.id) {
          const room = rooms.get(roomId);
          if (room) {
            room.removeUser(socket.id);
            socket.to(roomId).emit('user-left', { id: socket.id, username: user.username });
            
            // Update room count
            io.emit('room-updated', {
              id: room.id,
              name: room.name,
              userCount: room.users.size,
              createdBy: room.createdBy
            });
          }
        }
      });
      
      users.delete(socket.id);
    }
  });
});

// File download endpoint
app.get('/files/:id', (req, res) => {
  const filePath = path.join(__dirname, 'uploads', req.params.id);
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.status(404).send('File not found');
  }
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
