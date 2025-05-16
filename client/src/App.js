import React, { useState, useEffect, useRef } from 'react';
import './index.css';

function App() {
  const [username, setUsername] = useState('');
  const [connected, setConnected] = useState(false);
  const [playerId, setPlayerId] = useState(null);
  const [players, setPlayers] = useState({});
  const [pellets, setPellets] = useState({});
  const [worldSize, setWorldSize] = useState({ width: 2000, height: 2000 });
  const [isMobile, setIsMobile] = useState(false);
  const [joystickActive, setJoystickActive] = useState(false);
  const [joystickPos, setJoystickPos] = useState({ x: 0, y: 0 });
  const [knobPos, setKnobPos] = useState({ x: 0, y: 0 });
  
  // Camera position state (separate from player position)
  const [cameraPosition, setCameraPosition] = useState({ x: 0, y: 0 });
  
  const wsRef = useRef(null);
  const joystickRef = useRef(null);
  const animationFrameRef = useRef();
  const moveSpeed = 5; // Speed of movement in pixels
  const keysPressed = useRef({});
  const joystickSize = 120; // Size of the joystick base
  const knobSize = 50; // Size of the joystick knob
  const maxJoystickDistance = joystickSize / 2 - knobSize / 2;
  const cameraSmoothing = 0.1; // Lower = smoother but slower camera (0.05-0.2 is a good range)

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
          setPellets(data.pellets);
          if (data.worldSize) {
            setWorldSize(data.worldSize);
          }
          // Initialize camera at player position
          if (data.id && data.players[data.id]) {
            setCameraPosition({
              x: data.players[data.id].x,
              y: data.players[data.id].y
            });
          }
          setConnected(true);
          break;
          
        case 'gameState':
          // Handle incremental updates
          setPlayers(prevPlayers => {
            const updatedPlayers = { ...prevPlayers };
            
            // Add or update players
            if (data.players) {
              Object.keys(data.players).forEach(id => {
                updatedPlayers[id] = data.players[id];
              });
            }
            
            // Remove players that are no longer visible
            if (data.removedPlayers) {
              data.removedPlayers.forEach(id => {
                delete updatedPlayers[id];
              });
            }
            
            return updatedPlayers;
          });
          
          setPellets(prevPellets => {
            const updatedPellets = { ...prevPellets };
            
            // Add new pellets
            if (data.pellets) {
              Object.keys(data.pellets).forEach(id => {
                updatedPellets[id] = data.pellets[id];
              });
            }
            
            // Remove consumed/out of range pellets
            if (data.removedPellets) {
              data.removedPellets.forEach(id => {
                delete updatedPellets[id];
              });
            }
            
            return updatedPellets;
          });
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

    const gameLoop = setInterval(() => {
      if (!players[playerId]) return;
      let x = players[playerId].x;
      let y = players[playerId].y;
      let moved = false;
      const blobSize = players[playerId].size;

      // Calculate movement vector
      let moveVec = { x: 0, y: 0 };
      if (!isMobile) {
        if (keysPressed.current['w'] || keysPressed.current['arrowup']) moveVec.y -= 1;
        if (keysPressed.current['s'] || keysPressed.current['arrowdown']) moveVec.y += 1;
        if (keysPressed.current['a'] || keysPressed.current['arrowleft']) moveVec.x -= 1;
        if (keysPressed.current['d'] || keysPressed.current['arrowright']) moveVec.x += 1;
      }
      if (isMobile && joystickActive) {
        const dx = knobPos.x - joystickPos.x;
        const dy = knobPos.y - joystickPos.y;
        const length = Math.sqrt(dx * dx + dy * dy);
        if (length > 0) {
          moveVec.x += dx / length;
          moveVec.y += dy / length;
        }
      }
      // Normalize movement vector
      const length = Math.sqrt(moveVec.x * moveVec.x + moveVec.y * moveVec.y);
      if (length > 0) {
        moveVec.x /= length;
        moveVec.y /= length;
        x += moveVec.x * moveSpeed;
        y += moveVec.y * moveSpeed;
        moved = true;
      }
      // Keep player within world bounds
      x = Math.max(blobSize / 2, Math.min(worldSize.width - blobSize / 2, x));
      y = Math.max(blobSize / 2, Math.min(worldSize.height - blobSize / 2, y));
      if (moved && wsRef.current) {
        wsRef.current.send(JSON.stringify({
          type: 'move',
          x: x,
          y: y
        }));
      }
    }, 16);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      clearInterval(gameLoop);
    };
  }, [connected, playerId, players, isMobile, joystickActive, joystickPos, knobPos, worldSize]);

  // Smooth camera movement using requestAnimationFrame
  useEffect(() => {
    if (!connected || !playerId) return;
    
    const updateCamera = () => {
      if (players[playerId]) {
        const targetX = players[playerId].x;
        const targetY = players[playerId].y;
        
        // Interpolate between current camera position and target position
        setCameraPosition(prevPos => ({
          x: prevPos.x + (targetX - prevPos.x) * cameraSmoothing,
          y: prevPos.y + (targetY - prevPos.y) * cameraSmoothing
        }));
      }
      
      animationFrameRef.current = requestAnimationFrame(updateCamera);
    };
    
    animationFrameRef.current = requestAnimationFrame(updateCamera);
    
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [connected, playerId, players, cameraSmoothing]);

  // Touch event handlers for joystick
  const handleTouchStart = (e) => {
    if (!joystickRef.current) return;
    
    e.preventDefault();
    const touch = e.touches[0];
    const rect = joystickRef.current.getBoundingClientRect();
    
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
    
    const dx = touch.clientX - joystickPos.x;
    const dy = touch.clientY - joystickPos.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
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

  // Calculate camera position
  const cameraStyle = () => {
    if (!connected) return {};
    
    // Use the smooth camera position instead of directly using player position
    const offsetX = Math.min(0, Math.max(window.innerWidth / 2 - cameraPosition.x, window.innerWidth - worldSize.width));
    const offsetY = Math.min(0, Math.max(window.innerHeight / 2 - cameraPosition.y, window.innerHeight - worldSize.height));
    
    return {
      transform: `translate3d(${offsetX}px, ${offsetY}px, 0)`,
      width: `${worldSize.width}px`,
      height: `${worldSize.height}px`,
      position: 'absolute',
      backgroundSize: '50px 50px',
      backgroundImage: 'linear-gradient(to right, #ccc 1px, transparent 1px), linear-gradient(to bottom, #ccc 1px, transparent 1px)',
      willChange: 'transform', // Optimization for smoother animations
      backfaceVisibility: 'hidden', // Reduces flickering on some browsers
    };
  };

  // Get sorted players for leaderboard
  const getLeaderboard = () => {
    const playersList = Object.values(players);
    
    // Sort players by size (score) in descending order
    const sortedPlayers = [...playersList].sort((a, b) => b.size - a.size);
    
    // Return top 10 players
    return sortedPlayers.slice(0, 10);
  };

  // Count visible pellets and objects (for debugging)
  const visibleEntitiesCount = () => ({
    players: Object.keys(players).length,
    pellets: Object.keys(pellets).length
  });

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
          {/* Leaderboard Component */}
          <div className="leaderboard">
            <h3>Leaderboard</h3>
            <table className="leaderboard-table">
              <thead>
                <tr>
                  <th className="rank">No</th>
                  <th className="username">User</th>
                  <th className="score">Score</th>
                </tr>
              </thead>
              <tbody>
                {getLeaderboard().map((player, index) => (
                  <tr 
                    key={player.id} 
                    className={player.id === playerId ? "current-player" : ""}
                  >
                    <td className="rank">{index + 1}</td>
                    <td className="username">{player.username}</td>
                    <td className="score">{Math.floor(player.size)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="entities-count" style={{ fontSize: '10px', color: '#888', marginTop: '5px' }}>
              Visible objects: P:{visibleEntitiesCount().players} F:{visibleEntitiesCount().pellets}
            </div>
          </div>
          
          <div className="camera" style={cameraStyle()}>
            {Object.values(players).map((player) => (
              <div
                key={player.id}
                className="player"
                style={{
                  width: `${player.size}px`,
                  height: `${player.size}px`,
                  backgroundColor: player.color,
                  transform: `translate(${player.x - player.size / 2}px, ${player.y - player.size / 2}px)`,
                  fontSize: `${Math.min(16, player.size / 3)}px`,
                }}
              >
                {player.username}
              </div>
            ))}

            {Object.values(pellets).map((pellet) => (
              <div
                key={pellet.id}
                className="pellet"
                style={{
                  width: `${pellet.size}px`,
                  height: `${pellet.size}px`,
                  backgroundColor: '#FFD700', // Gold color for pellets
                  borderRadius: '50%',
                  position: 'absolute',
                  transform: `translate(${pellet.x - pellet.size / 2}px, ${pellet.y - pellet.size / 2}px)`,
                }}
              />
            ))}

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
                  position: 'fixed', // Changed to fixed so it stays in view
                  zIndex: 1000, // Ensure it's above other elements
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
          </div>
        </>
      )}
    </div>
  );
}

export default App;