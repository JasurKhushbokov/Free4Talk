import React, { useState, useEffect, useRef, useCallback } from 'react';
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
  const [hasVideo, setHasVideo] = useState(false);
  const [showParticipants, setShowParticipants] = useState(false);

  const localAudioRef = useRef(null);
  const remoteAudiosRef = useRef({});
  const peerConnectionsRef = useRef({});
  const localStreamRef = useRef(null);
  const localVideoRef = useRef(null);
  const remoteVideoRefs = useRef({});

  // WebRTC configuration
  const rtcConfig = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
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
      if (remoteVideoRefs.current[user.id]) {
        delete remoteVideoRefs.current[user.id];
      }
    });

    socket.on('user-muted', (data) => {
      setParticipants(prev => prev.map(p => p.id === data.userId ? { ...p, isMuted: data.isMuted } : p));
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
      socket.off('user-muted');
    };
  }, []);

  useEffect(() => {
    socket.on('new-message', (message) => {
      setMessages(prev => [...prev, message]);
    });
    
    return () => {
      socket.off('new-message');
    };
  }, []);

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

  // Initialize audio stream
  const initializeAudio = async () => {
    try {
      console.log('Initializing audio...');
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      
      console.log('Audio stream obtained:', stream.getAudioTracks());
      localStreamRef.current = stream;
      
      // Update all peer connections
      Object.values(peerConnectionsRef.current).forEach(pc => {
        stream.getAudioTracks().forEach(track => {
          pc.addTrack(track, stream);
        });
      });
      
      return true;
    } catch (error) {
      console.error('Audio initialization failed:', error);
      alert('Microphone access is required for voice chat');
      return false;
    }
  };

  const initializePeerConnection = useCallback((peerId) => {
    const pc = new RTCPeerConnection(rtcConfig);
    peerConnectionsRef.current[peerId] = pc;

    // Add local stream if available
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        pc.addTrack(track, localStreamRef.current);
      });
    }

    // Handle remote stream
    pc.ontrack = (event) => {
      const remoteStream = event.streams[0];
      if (!remoteVideoRefs.current[peerId]) {
        const video = document.createElement('video');
        video.srcObject = remoteStream;
        video.autoplay = true;
        video.className = 'remote-video';
        remoteVideoRefs.current[peerId] = video;
        document.getElementById('videos-container').appendChild(video);
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('ice-candidate', {
          candidate: event.candidate,
          target: peerId
        });
      }
    };
  }, []);

  const handleOffer = async (offer, senderId) => {
    try {
      const pc = peerConnectionsRef.current[senderId] || createPeerConnection(senderId);
      if (pc.signalingState === 'stable') {
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('answer', { answer, target: senderId });
      }
    } catch (err) {
      console.error('Error handling offer:', err);
    }
  };

  const handleAnswer = async (answer, senderId) => {
    try {
      const pc = peerConnectionsRef.current[senderId];
      if (pc && pc.signalingState === 'have-local-offer') {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
      }
    } catch (err) {
      console.error('Error setting remote answer:', err);
    }
  };

  const handleIceCandidate = async (candidate, senderId) => {
    const pc = peerConnectionsRef.current[senderId];
    if (pc && pc.remoteDescription) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.error('Error adding ICE candidate:', err);
      }
    }
  };

  const createPeerConnection = (peerId) => {
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
      if (!remoteVideoRefs.current[peerId]) {
        const video = document.createElement('video');
        video.srcObject = remoteStream;
        video.autoplay = true;
        remoteVideoRefs.current[peerId] = video;
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

    return peerConnection;
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

  const handleSendMessage = () => {
    if (newMessage.trim() && currentRoom) {
      const message = {
        text: newMessage,
        username,
        roomId: currentRoom.id
      };
      socket.emit('send-message', message);
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
    remoteVideoRefs.current = {};
    
    setCurrentView('lobby');
    setCurrentRoom(null);
    setParticipants([]);
    setMessages([]);
  };

  const toggleMute = async () => {
    try {
      if (!localStreamRef.current) {
        const success = await initializeAudio();
        if (!success) return;
      }

      const newMutedState = !isMuted;
      const audioTracks = localStreamRef.current.getAudioTracks();
      
      console.log(`Setting ${audioTracks.length} track(s) to:`, newMutedState);
      audioTracks.forEach(track => {
        track.enabled = newMutedState;
      });

      setIsMuted(newMutedState);
      socket.emit('user-muted', {
        userId: socket.id,
        isMuted: newMutedState
      });
    } catch (error) {
      console.error('Mute toggle error:', error);
    }
  };

  const toggleVideo = async () => {
    try {
      if (!localStreamRef.current) {
        const stream = await navigator.mediaDevices.getUserMedia({ 
          video: true, 
          audio: !isMuted 
        });
        localStreamRef.current = stream;
        localVideoRef.current.srcObject = stream;
      } else {
        const videoTracks = localStreamRef.current.getVideoTracks();
        const newVideoState = !hasVideo;
        
        if (newVideoState) {
          const stream = await navigator.mediaDevices.getUserMedia({ 
            video: true,
            audio: !isMuted
          });
          localStreamRef.current.getVideoTracks().forEach(track => track.stop());
          stream.getVideoTracks().forEach(track => {
            localStreamRef.current.addTrack(track);
            Object.values(peerConnectionsRef.current).forEach(pc => {
              pc.addTrack(track, localStreamRef.current);
            });
          });
          localVideoRef.current.srcObject = stream;
        } else {
          videoTracks.forEach(track => track.enabled = false);
        }
      }
      setHasVideo(prev => !prev);
      socket.emit('video-toggle', { 
        userId: socket.id, 
        hasVideo: !hasVideo 
      });
    } catch (err) {
      console.error('Error toggling video:', err);
    }
  };

  const handleFileUpload = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const fileData = {
          name: file.name,
          type: file.type,
          size: file.size,
          content: event.target.result.split(',')[1] // Remove data URL prefix
        };
        
        socket.emit('file-upload', fileData, currentRoom, (response) => {
          if (response.error) {
            reject(response.error);
          } else {
            resolve(response);
          }
        });
      };
      reader.readAsDataURL(file);
    });
  };

  const downloadFile = (fileId, fileName) => {
    window.open(`${process.env.REACT_APP_API_URL}/files/${fileId}?download=${fileName}`);
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
    <div className="chat-container">
      {/* Left sidebar - Chat */}
      <div className="chat-sidebar">
        <div className="messages">
          {messages.map((msg, i) => (
            <div 
              key={i} 
              className={`message ${msg.username === username ? 'sent' : 'received'}`}
              style={{ 
                display: 'flex', 
                justifyContent: msg.username === username ? 'flex-end' : 'flex-start', 
                marginBottom: '16px' 
              }}
            >
              <div className="message-text" style={{ 
                backgroundColor: msg.username === username ? '#48bb78' : '#e2e8f0', 
                color: msg.username === username ? '#fff' : '#2d3748', 
                padding: '8px', 
                borderRadius: '8px' 
              }}>
                {msg.text}
              </div>
              <div className="message-time" style={{ 
                fontSize: '12px', 
                color: '#718096', 
                marginLeft: msg.username === username ? '8px' : '0', 
                marginRight: msg.username === username ? '0' : '8px' 
              }}>
                {new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
              </div>
            </div>
          ))}
        </div>
        
        <div className="message-input">
          <input
            type="text"
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            onKeyPress={(e) => {
              if (e.key === 'Enter') {
                handleSendMessage();
              }
            }}
            placeholder="Type a message..."
          />
          <button 
            onClick={handleSendMessage}
            className="send-button"
            disabled={!newMessage.trim()}
          >
            <svg className="send-icon" viewBox="0 0 24 24">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
            </svg>
          </button>
        </div>
        
        <div className="file-sharing-ui">
          <input 
            type="file"
            onChange={(e) => {
              if (e.target.files[0]) {
                handleFileUpload(e.target.files[0])
                  .then(() => alert('File shared successfully!'))
                  .catch(err => alert(`Error: ${err}`));
              }
            }}
            style={{ display: 'none' }}
            id="file-input"
          />
          
          <button 
            onClick={() => document.getElementById('file-input').click()}
            className="file-share-btn"
          >
            📁 Share File
          </button>

          <div className="file-messages">
            {messages.filter(m => m.type === 'file').map(file => (
              <div key={file.id} className="file-message">
                <button 
                  onClick={() => downloadFile(file.id, file.name)}
                  className="file-download-btn"
                >
                  📄 {file.name} ({Math.round(file.size/1024)}KB)
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Main content - Videos */}
      <div className="video-main">
        <div id="videos-container" className="videos-grid">
          {localStreamRef.current && (
            <video 
              ref={localVideoRef}
              autoPlay
              muted
              className="local-video"
            />
          )}
        </div>

        <div className="control-bar">
          <button onClick={toggleMute} title={isMuted ? "Unmute" : "Mute"}>
            {isMuted ? '🔇' : '🎤'}
          </button>
          <button onClick={toggleVideo} title={hasVideo ? "Stop Video" : "Start Video"}>
            {hasVideo ? '📹' : '📷'}
          </button>
          <button onClick={handleLeaveRoom} title="Leave Room" style={{background: '#ff4d4f', color: 'white'}}>
            🚪
          </button>
        </div>

        <div className="participants-container">
          <button 
            onClick={() => setShowParticipants(!showParticipants)}
            className="participants-toggle"
            title={showParticipants ? "Hide participants" : "Show participants"}
          >
            👥 {participants.length}
          </button>
          
          {showParticipants && (
            <div className="participants-panel">
              {participants.map(participant => (
                <div key={participant.id} className="participant">
                  <span>
                    {participant.username}
                    {participant.isMuted && <span className="mute-icon">🔇</span>}
                    {!participant.hasVideo && <span className="video-off-icon">📷</span>}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
