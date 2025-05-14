import React, { useState, useEffect, useRef } from 'react';
import './index.css';

function App() {
  const [username, setUsername] = useState('');
  const [connected, setConnected] = useState(false);
  const [playerId, setPlayerId] = useState(null);
  const [players, setPlayers] = useState({});
  const wsRef = useRef(null);
  const blobSize = 50; // Size of the blob in pixels
  const moveSpeed = 5; // Speed of movement in pixels
  const keysPressed = useRef({});

  // Handle form submission
  const handleSubmit = (e) => {
    e.preventDefault();
    if (username.trim() === '') return;
    
    // Create WebSocket connection
    const ws = new WebSocket(`ws://${window.location.hostname}:8000`);
    wsRef.current = ws;
    
    ws.onopen = () => {
      console.log('Connected to server');
      ws.send(JSON.stringify({
        type: 'join',
        username: username
      }));
    };
    
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      switch (data.type) {
        case 'joined':
          setPlayerId(data.id);
          setPlayers(data.players);
          setConnected(true);
          break;
          
        case 'players':
          setPlayers(data.players);
          break;
          
        default:
          break;
      }
    };
    
    ws.onclose = () => {
      console.log('Disconnected from server');
      setConnected(false);
    };
  };

  // Handle keyboard controls
  useEffect(() => {
    if (!connected || !playerId) return;

    const handleKeyDown = (e) => {
      keysPressed.current[e.key.toLowerCase()] = true;
    };

    const handleKeyUp = (e) => {
      keysPressed.current[e.key.toLowerCase()] = false;
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    // Game loop for smooth movement
    const gameLoop = setInterval(() => {
      if (!players[playerId]) return;
      
      let x = players[playerId].x;
      let y = players[playerId].y;
      let moved = false;
      
      if (keysPressed.current['w'] || keysPressed.current['arrowup']) {
        y -= moveSpeed;
        moved = true;
      }
      if (keysPressed.current['s'] || keysPressed.current['arrowdown']) {
        y += moveSpeed;
        moved = true;
      }
      if (keysPressed.current['a'] || keysPressed.current['arrowleft']) {
        x -= moveSpeed;
        moved = true;
      }
      if (keysPressed.current['d'] || keysPressed.current['arrowright']) {
        x += moveSpeed;
        moved = true;
      }
      
      // Keep player within bounds
      x = Math.max(blobSize / 2, Math.min(window.innerWidth - blobSize / 2, x));
      y = Math.max(blobSize / 2, Math.min(window.innerHeight - blobSize / 2, y));
      
      if (moved && wsRef.current) {
        wsRef.current.send(JSON.stringify({
          type: 'move',
          x: x,
          y: y
        }));
      }
    }, 16); // ~60fps

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      clearInterval(gameLoop);
    };
  }, [connected, playerId, players]);

  // Clean up WebSocket on unmount
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  return (
    <div className="game-container">
      {!connected ? (
        <form className="login-form" onSubmit={handleSubmit}>
          <h2>Multiplayer Blob Game</h2>
          <input
            type="text"
            placeholder="Enter your username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <button type="submit">Join Game</button>
        </form>
      ) : (
        Object.values(players).map((player) => (
          <div
            key={player.id}
            className="player"
            style={{
              width: `${blobSize}px`,
              height: `${blobSize}px`,
              backgroundColor: player.color,
              transform: `translate(${player.x - blobSize / 2}px, ${player.y - blobSize / 2}px)`,
              fontSize: `${Math.min(16, blobSize / 3)}px`,
            }}
          >
            {player.username}
          </div>
        ))
      )}
    </div>
  );
}

export default App;