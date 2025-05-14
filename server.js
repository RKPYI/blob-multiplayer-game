const WebSocket = require('ws');
const http = require('http');
const express = require('express');
const path = require('path');

const app = express();
app.use(express.static(path.join(__dirname, 'client/build')));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Store connected players
const players = {};

wss.on('connection', (ws) => {
  console.log('New client connected');
  let playerId = null;

  ws.on('message', (message) => {
    const data = JSON.parse(message);
    
    switch (data.type) {
      case 'join':
        playerId = Date.now().toString();
        players[playerId] = {
          id: playerId,
          x: Math.floor(Math.random() * 400) + 50,
          y: Math.floor(Math.random() * 400) + 50,
          username: data.username,
          color: getRandomColor()
        };
        
        // Send the new player their ID
        ws.send(JSON.stringify({
          type: 'joined',
          id: playerId,
          players
        }));
        
        // Broadcast to all other players about the new player
        broadcastPlayerList();
        break;
        
      case 'move':
        if (playerId && players[playerId]) {
          players[playerId].x = data.x;
          players[playerId].y = data.y;
          broadcastPlayerList();
        }
        break;
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
    if (playerId) {
      delete players[playerId];
      broadcastPlayerList();
    }
  });
  
  // Helper function to broadcast the player list to all clients
  function broadcastPlayerList() {
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({
          type: 'players',
          players
        }));
      }
    });
  }
  
  // Generate a random color for the player
  function getRandomColor() {
    const colors = ['#FF5733', '#33FF57', '#3357FF', '#F3FF33', '#FF33F3', '#33FFF3'];
    return colors[Math.floor(Math.random() * colors.length)];
  }
});

const PORT = process.env.PORT || 8000;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});