const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

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
    this.messages.push({
      id: uuidv4(),
      ...message,
      timestamp: new Date()
    });
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
  socket.on('send-message', (data) => {
    const user = users.get(socket.id);
    if (!user) return;

    const roomId = [...socket.rooms].find(room => room !== socket.id);
    const room = rooms.get(roomId);
    
    if (!room) return;

    const message = {
      userId: user.id,
      username: user.username,
      content: data.content,
      type: 'text'
    };

    room.addMessage(message);
    io.to(roomId).emit('new-message', {
      id: room.messages[room.messages.length - 1].id,
      ...message,
      timestamp: room.messages[room.messages.length - 1].timestamp
    });
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

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
