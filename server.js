const WebSocket = require('ws');
const http = require('http');
const express = require('express');
const path = require('path');

// QuadTree implementation for spatial partitioning
class QuadTree {
  constructor(boundary, capacity) {
    this.boundary = boundary; // {x, y, width, height}
    this.capacity = capacity; // max number of entities before subdivision
    this.entities = []; // entities in this quad
    this.divided = false; // whether this quad has been subdivided
    this.northwest = null;
    this.northeast = null;
    this.southwest = null;
    this.southeast = null;
  }

  // Check if this quadtree contains a point
  contains(point) {
    return (
      point.x >= this.boundary.x &&
      point.x <= this.boundary.x + this.boundary.width &&
      point.y >= this.boundary.y &&
      point.y <= this.boundary.y + this.boundary.height
    );
  }

  // Insert an entity into the quadtree
  insert(entity) {
    if (!this.contains({ x: entity.x, y: entity.y })) {
      return false;
    }

    if (this.entities.length < this.capacity && !this.divided) {
      this.entities.push(entity);
      return true;
    }

    if (!this.divided) {
      this.subdivide();
    }

    return (
      this.northwest.insert(entity) ||
      this.northeast.insert(entity) ||
      this.southwest.insert(entity) ||
      this.southeast.insert(entity)
    );
  }

  // Subdivide this quadtree into four quadrants
  subdivide() {
    const x = this.boundary.x;
    const y = this.boundary.y;
    const w = this.boundary.width / 2;
    const h = this.boundary.height / 2;

    const nw = { x: x, y: y, width: w, height: h };
    const ne = { x: x + w, y: y, width: w, height: h };
    const sw = { x: x, y: y + h, width: w, height: h };
    const se = { x: x + w, y: y + h, width: w, height: h };

    this.northwest = new QuadTree(nw, this.capacity);
    this.northeast = new QuadTree(ne, this.capacity);
    this.southwest = new QuadTree(sw, this.capacity);
    this.southeast = new QuadTree(se, this.capacity);

    this.divided = true;

    // Move existing entities to appropriate quadrants
    for (let entity of this.entities) {
      this.northwest.insert(entity) ||
      this.northeast.insert(entity) ||
      this.southwest.insert(entity) ||
      this.southeast.insert(entity);
    }
    
    this.entities = []; // Clear the parent node's entities
  }

  // Query all entities within a specified range
  query(range, found = []) {
    if (!this.intersects(range)) {
      return found;
    }

    for (let entity of this.entities) {
      if (
        entity.x >= range.x - range.radius &&
        entity.x <= range.x + range.radius &&
        entity.y >= range.y - range.radius &&
        entity.y <= range.y + range.radius
      ) {
        found.push(entity);
      }
    }

    if (this.divided) {
      this.northwest.query(range, found);
      this.northeast.query(range, found);
      this.southwest.query(range, found);
      this.southeast.query(range, found);
    }

    return found;
  }

  // Check if the range intersects with this quadtree
  intersects(range) {
    return !(
      range.x - range.radius > this.boundary.x + this.boundary.width ||
      range.x + range.radius < this.boundary.x ||
      range.y - range.radius > this.boundary.y + this.boundary.height ||
      range.y + range.radius < this.boundary.y
    );
  }

  // Clear the quadtree
  clear() {
    this.entities = [];
    this.divided = false;
    this.northwest = null;
    this.northeast = null;
    this.southwest = null;
    this.southeast = null;
  }
}

const app = express();
app.use(express.static(path.join(__dirname, 'client/build')));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Game settings
const players = {};
const pellets = {};
const pelletSize = 10;
const pelletSpawnBatchSize = 20; // Number of pellets to spawn at once
const pelletSpawnInterval = 3000; // Spawn pellets less frequently
const maxPellets = 300; // Cap on total pellets (reduced from 1000)
const sizeIncrease = 1;
const WORLD_WIDTH = 2000;
const WORLD_HEIGHT = 2000;
const RENDER_DISTANCE = 1000; // Distance within which entities are visible to players
const BATCH_SPAWN_MIN_DISTANCE = 100; // Min distance between pellets in a batch

// Initialize QuadTree for the entire game world
let entityQuadTree = new QuadTree({ 
  x: 0, y: 0, width: WORLD_WIDTH, height: WORLD_HEIGHT 
}, 10);

// Client-specific data for tracking what's been sent
const clientState = {};

// Track changed entities to optimize broadcasts
let changedPellets = new Set();
let changedPlayers = new Set();

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
          x: Math.floor(Math.random() * WORLD_WIDTH),
          y: Math.floor(Math.random() * WORLD_HEIGHT),
          username: data.username,
          color: getRandomColor(),
          size: 50,
          ws: ws  // Store reference to the WebSocket
        };
        
        // Initialize client state for tracking what's been sent
        clientState[playerId] = {
          knownPellets: new Set(),
          knownPlayers: new Set(),
          lastX: players[playerId].x,
          lastY: players[playerId].y
        };
        
        changedPlayers.add(playerId);
        
        // Send the new player their ID and initial game state
        sendInitialState(ws, playerId);
        break;
        
      case 'move':
        if (playerId && players[playerId]) {
          console.log(`Player ${playerId} moved to ${data.x}, ${data.y}`);
          // Update player position
          const oldX = players[playerId].x;
          const oldY = players[playerId].y;
          players[playerId].x = data.x;
          players[playerId].y = data.y;
          
          // Mark this player as changed if they moved
          if (oldX !== data.x || oldY !== data.y) {
            changedPlayers.add(playerId);
          }

          // Check for pellet collisions using QuadTree
          const playerRange = {
            x: players[playerId].x,
            y: players[playerId].y,
            radius: players[playerId].size / 2
          };
          
          const nearbyPellets = entityQuadTree.query(playerRange);
          
          nearbyPellets.forEach(entity => {
            // Skip non-pellet entities
            if (!entity.isPellet) return;
            
            const pellet = pellets[entity.id];
            if (!pellet) return;
            
            const dx = players[playerId].x - pellet.x;
            const dy = players[playerId].y - pellet.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            if (distance < (players[playerId].size + pelletSize) / 2) {
              // Collision detected
              players[playerId].size += sizeIncrease;
              delete pellets[entity.id];
              changedPlayers.add(playerId);
              
              // Mark pellet as consumed for all clients
              changedPellets.add(entity.id);
            }
          });
          
          // Only broadcast if necessary
          broadcastGameStateToNearbyPlayers(playerId);
        }
        break;
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
    if (playerId) {
      delete players[playerId];
      delete clientState[playerId];
      
      // Mark player as removed
      changedPlayers.add(playerId);
      
      broadcastGameStateToAll();
    }
  });
  
  // Generate a random color for the player
  function getRandomColor() {
    const colors = ['#FF5733', '#33FF57', '#3357FF', '#F3FF33', '#FF33F3', '#33FFF3'];
    return colors[Math.floor(Math.random() * colors.length)];
  }
});

// Send initial state to a newly connected player
function sendInitialState(ws, playerId) {
  if (!players[playerId]) return;
  
  // For new players, send all pellets and players within render distance
  const player = players[playerId];
  const nearbyPlayers = {};
  const nearbyPellets = {};
  
  // Get all entities near the new player
  const queryRange = {
    x: player.x,
    y: player.y,
    radius: RENDER_DISTANCE
  };
  
  // Players
  Object.keys(players).forEach(id => {
    const otherPlayer = players[id];
    const dx = player.x - otherPlayer.x;
    const dy = player.y - otherPlayer.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    if (distance <= RENDER_DISTANCE) {
      nearbyPlayers[id] = otherPlayer;
      clientState[playerId].knownPlayers.add(id);
    }
  });
  
  // Pellets
  const nearbyEntities = entityQuadTree.query(queryRange);
  nearbyEntities.forEach(entity => {
    if (entity.isPellet && pellets[entity.id]) {
      nearbyPellets[entity.id] = pellets[entity.id];
      clientState[playerId].knownPellets.add(entity.id);
    }
  });
  
  // Send initial state
  ws.send(JSON.stringify({
    type: 'joined',
    id: playerId,
    players: nearbyPlayers,
    pellets: nearbyPellets,
    worldSize: { width: WORLD_WIDTH, height: WORLD_HEIGHT }
  }));
}

// Broadcast game state only to players who are near specific events
function broadcastGameStateToNearbyPlayers(sourcePlayerId) {
  if (!players[sourcePlayerId]) return;
  
  const sourcePlayer = players[sourcePlayerId];
  const sourceX = sourcePlayer.x;
  const sourceY = sourcePlayer.y;
  
  wss.clients.forEach(client => {
    if (client.readyState !== WebSocket.OPEN) return;
    
    // Find the client's player ID by WebSocket reference
    let clientId = null;
    for (const id in players) {
      if (players[id].ws === client) {
        clientId = id;
        break;
      }
    }
    
    if (!clientId || !players[clientId]) return;
    
    // Calculate distance between source and client player
    const clientPlayer = players[clientId];
    const dx = sourceX - clientPlayer.x;
    const dy = sourceY - clientPlayer.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    // Only send updates if players are close enough
    if (distance <= RENDER_DISTANCE) {
      sendRelevantGameState(client, clientId);
    }
  });
}

// Broadcast game state to all connected clients
function broadcastGameStateToAll() {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      // Find the client's player ID
      let clientId = null;
      for (const id in players) {
        if (players[id].ws === client) {
          clientId = id;
          break;
        }
      }
      
      if (clientId && players[clientId]) {
        sendRelevantGameState(client, clientId);
      }
    }
  });
}

// Send only relevant updates to a client
function sendRelevantGameState(client, playerId) {
  if (!players[playerId] || !clientState[playerId]) return;
  
  const player = players[playerId];
  const cState = clientState[playerId];
  
  // Get entities within render distance
  const visibleRange = {
    x: player.x,
    y: player.y,
    radius: RENDER_DISTANCE
  };
  
  // Track changes to send
  const updates = {
    type: 'gameState',
    players: {},
    pellets: {},
    removedPellets: [],
    removedPlayers: []
  };
  
  // Update client with changed players within range
  changedPlayers.forEach(id => {
    // If player was deleted
    if (!players[id]) {
      if (cState.knownPlayers.has(id)) {
        updates.removedPlayers.push(id);
        cState.knownPlayers.delete(id);
      }
      return;
    }
    
    const otherPlayer = players[id];
    const dx = player.x - otherPlayer.x;
    const dy = player.y - otherPlayer.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    // Player is within range: add if changed or new
    if (distance <= RENDER_DISTANCE) {
      // Exclude WebSocket reference before adding to updates
      const { ws, ...playerData } = otherPlayer;
      updates.players[id] = playerData;
      cState.knownPlayers.add(id);
    } 
    // Player is out of range but was known: remove
    else if (cState.knownPlayers.has(id)) {
      updates.removedPlayers.push(id);
      cState.knownPlayers.delete(id);
    }
  });
  
  // Get nearby pellets
  const nearbyEntities = entityQuadTree.query(visibleRange);
  
  // Track newly visible pellets
  nearbyEntities.forEach(entity => {
    if (entity.isPellet && pellets[entity.id]) {
      // Only send if this is a new pellet for this client
      if (!cState.knownPellets.has(entity.id)) {
        updates.pellets[entity.id] = pellets[entity.id];
        cState.knownPellets.add(entity.id);
      }
    }
  });
  
  // Add removed pellets to updates
  changedPellets.forEach(id => {
    if (!pellets[id] && cState.knownPellets.has(id)) {
      updates.removedPellets.push(id);
      cState.knownPellets.delete(id);
    }
  });
  
  // Update client's position tracking
  cState.lastX = player.x;
  cState.lastY = player.y;
  
  // Only send if there are meaningful updates
  if (Object.keys(updates.players).length > 0 || 
      Object.keys(updates.pellets).length > 0 ||
      updates.removedPellets.length > 0 ||
      updates.removedPlayers.length > 0) {
    client.send(JSON.stringify(updates));
  }
}

// Clear changed entities after broadcasting
function clearChangedEntities() {
  changedPellets.clear();
  changedPlayers.clear();
}

// Rebuild the quadtree with current entities
function updateQuadTree() {
  entityQuadTree.clear();
  
  // Insert all pellets
  Object.keys(pellets).forEach(id => {
    const pellet = pellets[id];
    // Add a type flag to identify pellets in the quadtree
    entityQuadTree.insert({
      id,
      x: pellet.x, 
      y: pellet.y,
      isPellet: true
    });
  });
  
  // Insert all players
  Object.keys(players).forEach(id => {
    const player = players[id];
    // Add a type flag to identify players in the quadtree
    entityQuadTree.insert({
      id, 
      x: player.x,
      y: player.y, 
      size: player.size,
      isPlayer: true
    });
  });
}

// Spawn pellets in batches
function spawnPelletBatch() {
  const pelletAmount = Object.keys(pellets).length;
  console.log('pellets: ', pelletAmount);
  
  if (pelletAmount >= maxPellets) return;
  
  // Calculate number of pellets to spawn in this batch
  const spawnCount = Math.min(pelletSpawnBatchSize, maxPellets - pelletAmount);
  
  // Spawn pellets with minimum distance between them
  for (let i = 0; i < spawnCount; i++) {
    const pelletId = Date.now().toString() + i;
    
    // Try to find a valid position
    let validPosition = false;
    let attempts = 0;
    let x, y;
    
    while (!validPosition && attempts < 10) {
      x = Math.floor(Math.random() * WORLD_WIDTH);
      y = Math.floor(Math.random() * WORLD_HEIGHT);
      
      // Check if too close to other pellets
      const closeEntities = entityQuadTree.query({ 
        x, y, radius: BATCH_SPAWN_MIN_DISTANCE 
      });
      
      validPosition = closeEntities.length === 0;
      attempts++;
    }
    
    // Create the pellet with final position
    pellets[pelletId] = {
      id: pelletId,
      x: x,
      y: y,
      size: pelletSize
    };
    
    // Add to changed list
    changedPellets.add(pelletId);
    
    // Insert into quadtree
    entityQuadTree.insert({
      id: pelletId,
      x: x, 
      y: y,
      isPellet: true
    });
  }
}

// Game loop
setInterval(() => {
  // Update the quadtree with current entities
  updateQuadTree();
  
  // Spawn pellet batch
  spawnPelletBatch();
  
  // Send updates to all clients
  broadcastGameStateToAll();
  
  // Clear changed entities for next cycle
  clearChangedEntities();
}, 50); // 20 updates per second

// Spawn initial pellets
spawnPelletBatch();

const PORT = process.env.PORT || 8000;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});