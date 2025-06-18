import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import './App.css';

const socket = io('http://localhost:5000');

function App() {
  const [username, setUsername] = useState('');
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [currentView, setCurrentView] = useState('lobby'); // 'lobby' or 'room'
  const [rooms, setRooms] = useState([]);
  const [currentRoom, setCurrentRoom] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [newRoomName, setNewRoomName] = useState('');
  const [isMuted, setIsMuted] = useState(false);
  const [isConnected, setIsConnected] = useState(false);

  const localAudioRef = useRef(null);
  const remoteAudiosRef = useRef({});
  const peerConnectionsRef = useRef({});
  const localStreamRef = useRef(null);

  // WebRTC configuration
  const rtcConfig = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  };

  useEffect(() => {
    // Socket event listeners
    socket.on('connect', () => {
      setIsConnected(true);
    });

    socket.on('disconnect', () => {
      setIsConnected(false);
    });

    socket.on('user-joined', (user) => {
      console.log('User joined app:', user);
    });

    socket.on('rooms-list', (roomsList) => {
      setRooms(roomsList);
    });

    socket.on('room-created', (room) => {
      setRooms(prev => [...prev, room]);
    });

    socket.on('room-updated', (room) => {
      setRooms(prev => prev.map(r => r.id === room.id ? room : r));
    });

    socket.on('joined-room', (data) => {
      setCurrentRoom(data.room);
      setParticipants(data.users);
      setMessages(data.messages);
      setCurrentView('room');
    });

    socket.on('user-joined-room', (user) => {
      setParticipants(prev => [...prev, user]);
      // Initialize WebRTC connection for new user
      initializePeerConnection(user.id);
    });

    socket.on('user-left', (user) => {
      setParticipants(prev => prev.filter(p => p.id !== user.id));
      // Clean up peer connection
      if (peerConnectionsRef.current[user.id]) {
        peerConnectionsRef.current[user.id].close();
        delete peerConnectionsRef.current[user.id];
      }
      if (remoteAudiosRef.current[user.id]) {
        delete remoteAudiosRef.current[user.id];
      }
    });

    socket.on('new-message', (message) => {
      setMessages(prev => [...prev, message]);
    });

    // WebRTC signaling
    socket.on('offer', async (data) => {
      await handleOffer(data.offer, data.sender);
    });

    socket.on('answer', async (data) => {
      await handleAnswer(data.answer, data.sender);
    });

    socket.on('ice-candidate', async (data) => {
      await handleIceCandidate(data.candidate, data.sender);
    });

    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('user-joined');
      socket.off('rooms-list');
      socket.off('room-created');
      socket.off('room-updated');
      socket.off('joined-room');
      socket.off('user-joined-room');
      socket.off('user-left');
      socket.off('new-message');
      socket.off('offer');
      socket.off('answer');
      socket.off('ice-candidate');
    };
  }, []);

  // Initialize audio stream
  const initializeAudio = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;
      if (localAudioRef.current) {
        localAudioRef.current.srcObject = stream;
      }
      return stream;
    } catch (error) {
      console.error('Error accessing microphone:', error);
      alert('Please allow microphone access to use voice chat');
    }
  };

  // Initialize peer connection
  const initializePeerConnection = async (peerId) => {
    if (!localStreamRef.current) {
      await initializeAudio();
    }

    const peerConnection = new RTCPeerConnection(rtcConfig);
    peerConnectionsRef.current[peerId] = peerConnection;

    // Add local stream to peer connection
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStreamRef.current);
      });
    }

    // Handle remote stream
    peerConnection.ontrack = (event) => {
      const remoteStream = event.streams[0];
      if (!remoteAudiosRef.current[peerId]) {
        const audio = new Audio();
        audio.srcObject = remoteStream;
        audio.autoplay = true;
        remoteAudiosRef.current[peerId] = audio;
      }
    };

    // Handle ICE candidates
    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('ice-candidate', {
          candidate: event.candidate,
          target: peerId
        });
      }
    };

    // Create and send offer
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socket.emit('offer', { offer, target: peerId });
  };

  // Handle incoming offer
  const handleOffer = async (offer, senderId) => {
    if (!localStreamRef.current) {
      await initializeAudio();
    }

    const peerConnection = new RTCPeerConnection(rtcConfig);
    peerConnectionsRef.current[senderId] = peerConnection;

    // Add local stream
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStreamRef.current);
      });
    }

    // Handle remote stream
    peerConnection.ontrack = (event) => {
      const remoteStream = event.streams[0];
      if (!remoteAudiosRef.current[senderId]) {
        const audio = new Audio();
        audio.srcObject = remoteStream;
        audio.autoplay = true;
        remoteAudiosRef.current[senderId] = audio;
      }
    };

    // Handle ICE candidates
    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('ice-candidate', {
          candidate: event.candidate,
          target: senderId
        });
      }
    };

    await peerConnection.setRemoteDescription(offer);
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    socket.emit('answer', { answer, target: senderId });
  };

  // Handle incoming answer
  const handleAnswer = async (answer, senderId) => {
    const peerConnection = peerConnectionsRef.current[senderId];
    if (peerConnection) {
      await peerConnection.setRemoteDescription(answer);
    }
  };

  // Handle ICE candidate
  const handleIceCandidate = async (candidate, senderId) => {
    const peerConnection = peerConnectionsRef.current[senderId];
    if (peerConnection) {
      await peerConnection.addIceCandidate(candidate);
    }
  };

  const handleLogin = (e) => {
    e.preventDefault();
    if (username.trim()) {
      socket.emit('join-app', username.trim());
      setIsLoggedIn(true);
    }
  };

  const handleCreateRoom = (e) => {
    e.preventDefault();
    if (newRoomName.trim()) {
      socket.emit('create-room', newRoomName.trim());
      setNewRoomName('');
    }
  };

  const handleJoinRoom = async (roomId) => {
    await initializeAudio();
    socket.emit('join-room', roomId);
  };

  const handleSendMessage = (e) => {
    e.preventDefault();
    if (newMessage.trim()) {
      socket.emit('send-message', { content: newMessage.trim() });
      setNewMessage('');
    }
  };

  const handleLeaveRoom = () => {
    // Clean up audio streams and peer connections
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
    }
    
    Object.values(peerConnectionsRef.current).forEach(pc => pc.close());
    peerConnectionsRef.current = {};
    remoteAudiosRef.current = {};
    
    setCurrentView('lobby');
    setCurrentRoom(null);
    setParticipants([]);
    setMessages([]);
  };

  const toggleMute = () => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMuted(!audioTrack.enabled);
      }
    }
  };

  if (!isLoggedIn) {
    return (
      <div className="container">
        <div className="card" style={{ maxWidth: '400px', margin: '100px auto' }}>
          <h1 style={{ textAlign: 'center', marginBottom: '24px', color: '#2d3748' }}>
            Voice Chat App
          </h1>
          <form onSubmit={handleLogin}>
            <input
              type="text"
              placeholder="Enter your username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="input"
              style={{ marginBottom: '16px' }}
              required
            />
            <button type="submit" className="btn" style={{ width: '100%' }}>
              Join Chat
            </button>
          </form>
          <div style={{ textAlign: 'center', marginTop: '16px', color: isConnected ? '#48bb78' : '#e53e3e' }}>
            {isConnected ? '🟢 Connected' : '🔴 Disconnected'}
          </div>
        </div>
      </div>
    );
  }

  if (currentView === 'lobby') {
    return (
      <div className="container">
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
            <h1 style={{ color: '#2d3748' }}>Welcome, {username}!</h1>
            <div style={{ color: isConnected ? '#48bb78' : '#e53e3e' }}>
              {isConnected ? '🟢 Connected' : '🔴 Disconnected'}
            </div>
          </div>
          
          <form onSubmit={handleCreateRoom} style={{ marginBottom: '24px' }}>
            <div style={{ display: 'flex', gap: '12px' }}>
              <input
                type="text"
                placeholder="Room name"
                value={newRoomName}
                onChange={(e) => setNewRoomName(e.target.value)}
                className="input"
                style={{ flex: 1 }}
                required
              />
              <button type="submit" className="btn">
                Create Room
              </button>
            </div>
          </form>

          <h2 style={{ marginBottom: '16px', color: '#4a5568' }}>Available Rooms</h2>
          {rooms.length === 0 ? (
            <div className="loading">No rooms available. Create one to get started!</div>
          ) : (
            <div className="room-grid">
              {rooms.map(room => (
                <div key={room.id} className="room-card" onClick={() => handleJoinRoom(room.id)}>
                  <h3 style={{ marginBottom: '8px', color: '#2d3748' }}>{room.name}</h3>
                  <p style={{ color: '#718096', marginBottom: '8px' }}>
                    Created by: {room.createdBy}
                  </p>
                  <p style={{ color: '#667eea', fontWeight: '500' }}>
                    👥 {room.userCount} participant{room.userCount !== 1 ? 's' : ''}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <div className="card" style={{ marginBottom: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1 style={{ color: '#2d3748' }}>🎙️ {currentRoom?.name}</h1>
          <button onClick={handleLeaveRoom} className="btn btn-secondary">
            Leave Room
          </button>
        </div>
      </div>

      <div className="chat-container">
        <div className="voice-panel">
          <h2 style={{ marginBottom: '16px', color: '#4a5568' }}>Voice Chat</h2>
          
          <div className="participants">
            <h3 style={{ marginBottom: '12px', color: '#2d3748' }}>
              Participants ({participants.length})
            </h3>
            {participants.map(participant => (
              <div key={participant.id} className="participant">
                <span>{participant.username}</span>
                <span style={{ fontSize: '12px', color: '#718096' }}>
                  {participant.id === socket.id ? '(You)' : '🎤'}
                </span>
              </div>
            ))}
          </div>

          <div className="audio-controls">
            <button
              onClick={toggleMute}
              className={`mute-btn ${isMuted ? 'muted' : 'unmuted'}`}
              title={isMuted ? 'Unmute' : 'Mute'}
            >
              {isMuted ? '🔇' : '🎤'}
            </button>
          </div>

          <audio ref={localAudioRef} muted style={{ display: 'none' }} />
        </div>

        <div className="chat-panel">
          <h2 style={{ marginBottom: '16px', color: '#4a5568' }}>Text Chat</h2>
          
          <div className="messages">
            {messages.length === 0 ? (
              <div style={{ textAlign: 'center', color: '#718096', padding: '20px' }}>
                No messages yet. Start the conversation!
              </div>
            ) : (
              messages.map(message => (
                <div key={message.id} className="message">
                  <div className="message-header">
                    {message.username}
                    <span style={{ float: 'right', fontWeight: 'normal', fontSize: '12px' }}>
                      {new Date(message.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                  <div>{message.content}</div>
                </div>
              ))
            )}
          </div>

          <form onSubmit={handleSendMessage}>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type="text"
                placeholder="Type a message..."
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                className="input"
                style={{ flex: 1 }}
                required
              />
              <button type="submit" className="btn">
                Send
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

export default App;
