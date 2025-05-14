import React, { useState, useEffect, useRef } from 'react';
import './index.css';

function App() {
  const [username, setUsername] = useState('');
  const [connected, setConnected] = useState(false);
  const [playerId, setPlayerId] = useState(null);
  const [players, setPlayers] = useState({});
  const [isMobile, setIsMobile] = useState(false);
  const [joystickActive, setJoystickActive] = useState(false);
  const [joystickPos, setJoystickPos] = useState({ x: 0, y: 0 });
  const [knobPos, setKnobPos] = useState({ x: 0, y: 0 });
  
  const wsRef = useRef(null);
  const joystickRef = useRef(null);
  const blobSize = 50; // Size of the blob in pixels
  const moveSpeed = 5; // Speed of movement in pixels
  const keysPressed = useRef({});
  const joystickSize = 120; // Size of the joystick base
  const knobSize = 50; // Size of the joystick knob
  const maxJoystickDistance = joystickSize / 2 - knobSize / 2;

  // Detect mobile device
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent));
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

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
      
      // Handle keyboard movement
      if (!isMobile) {
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
      }
      
      // Handle joystick movement for mobile
      if (isMobile && joystickActive) {
        const dx = knobPos.x - joystickPos.x;
        const dy = knobPos.y - joystickPos.y;
        
        // Calculate normalized direction vector
        const length = Math.sqrt(dx * dx + dy * dy);
        if (length > 0) {
          const normalized = {
            x: dx / length,
            y: dy / length
          };
          
          // Apply movement based on joystick direction
          x += normalized.x * moveSpeed;
          y += normalized.y * moveSpeed;
          moved = true;
        }
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
  }, [connected, playerId, players, isMobile, joystickActive, joystickPos, knobPos]);

  // Touch event handlers for joystick
  const handleTouchStart = (e) => {
    if (!joystickRef.current) return;
    
    e.preventDefault();
    const touch = e.touches[0];
    const rect = joystickRef.current.getBoundingClientRect();
    
    // Center position of the joystick
    const joystickCenter = {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2
    };
    
    setJoystickPos(joystickCenter);
    setKnobPos({
      x: touch.clientX,
      y: touch.clientY
    });
    setJoystickActive(true);
  };

  const handleTouchMove = (e) => {
    if (!joystickActive) return;
    
    e.preventDefault();
    const touch = e.touches[0];
    
    // Calculate distance from center
    const dx = touch.clientX - joystickPos.x;
    const dy = touch.clientY - joystickPos.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    // Constrain knob position to the joystick radius
    if (distance > maxJoystickDistance) {
      const angle = Math.atan2(dy, dx);
      setKnobPos({
        x: joystickPos.x + Math.cos(angle) * maxJoystickDistance,
        y: joystickPos.y + Math.sin(angle) * maxJoystickDistance
      });
    } else {
      setKnobPos({
        x: touch.clientX,
        y: touch.clientY
      });
    }
  };

  const handleTouchEnd = () => {
    // Reset joystick to center
    setJoystickActive(false);
    setKnobPos(joystickPos);
  };

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
        <>
          {Object.values(players).map((player) => (
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
          ))}
          
          {/* Mobile Joystick Control */}
          {isMobile && connected && (
            <div 
              className="joystick-container"
              ref={joystickRef}
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
              style={{
                width: `${joystickSize}px`,
                height: `${joystickSize}px`,
                bottom: '20px', 
                left: '20px',
                position: 'absolute',
              }}
            >
              <div 
                className="joystick-base"
                style={{
                  width: '100%',
                  height: '100%',
                  borderRadius: '50%',
                  backgroundColor: 'rgba(255, 255, 255, 0.3)',
                  border: '2px solid rgba(255, 255, 255, 0.5)',
                  display: 'flex',
                  justifyContent: 'center',
                  alignItems: 'center',
                  position: 'relative',
                }}
              >
                <div 
                  className="joystick-knob"
                  style={{
                    width: `${knobSize}px`,
                    height: `${knobSize}px`,
                    borderRadius: '50%',
                    backgroundColor: 'rgba(255, 255, 255, 0.8)',
                    position: 'absolute',
                    transform: joystickActive
                      ? `translate(${knobPos.x - joystickPos.x}px, ${knobPos.y - joystickPos.y}px)`
                      : 'translate(0, 0)',
                    transition: joystickActive ? 'none' : 'transform 0.2s ease',
                  }}
                />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default App;